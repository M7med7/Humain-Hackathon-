import type { Request } from 'express';

type RouteRule = { method: string; pattern: RegExp };

// The only non-read routes judges may call: AI answers built from what they can
// already see. Neither route saves anything.
const GUEST_AI_ROUTES: RouteRule[] = [
  { method: 'POST', pattern: /^\/ai\/chat$/ },
  { method: 'POST', pattern: /^\/reports\/projects\/[^/]+\/generate$/ },
];

const HOUR_MS = 60 * 60 * 1000;
const PER_JUDGE_PER_HOUR = 20;
// Every "Enter as a judge" is a new anonymous user, so judges also share one budget.
const ALL_JUDGES_PER_HOUR = 150;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_CONTEXT_CHARS = 30_000;
const MAX_TRACKED_JUDGES = 5_000;

interface Window {
  count: number;
  resetAt: number;
}

const judgeWindows = new Map<string, Window>();
let sharedWindow: Window = { count: 0, resetAt: 0 };

export interface GuestRefusal {
  status: number;
  message: string;
}

export function isGuestAiRoute(req: Request): boolean {
  return GUEST_AI_ROUTES.some((rule) => rule.method === req.method && rule.pattern.test(req.path));
}

/** Anything but a short string (an array, an object, a long text) is refused. */
function tooLong(value: unknown, max: number): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== 'string' || value.length > max;
}

function counted(window: Window | undefined, now: number): Window {
  const current = !window || window.resetAt <= now ? { count: 0, resetAt: now + HOUR_MS } : window;
  return { count: current.count + 1, resetAt: current.resetAt };
}

/** Returns why a judge's AI request is refused, or null when it may go ahead. */
export function guestAiRefusal(req: Request, judgeId: string, now = Date.now()): GuestRefusal | null {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (tooLong(body.message, MAX_MESSAGE_CHARS) || tooLong(body.context, MAX_CONTEXT_CHARS)) {
    return { status: 413, message: 'That message is too long. Please shorten it and try again.' };
  }

  const judge = counted(judgeWindows.get(judgeId), now);
  const shared = counted(sharedWindow, now);
  if (judge.count > PER_JUDGE_PER_HOUR || shared.count > ALL_JUDGES_PER_HOUR) {
    return { status: 429, message: 'The AI is busy for judge accounts right now. Please try again later.' };
  }

  if (judgeWindows.size >= MAX_TRACKED_JUDGES && !judgeWindows.has(judgeId)) judgeWindows.clear();
  judgeWindows.set(judgeId, judge);
  sharedWindow = shared;
  return null;
}

export function resetGuestAiLimits(): void {
  judgeWindows.clear();
  sharedWindow = { count: 0, resetAt: 0 };
}
