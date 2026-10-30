import type { NextFunction, Request, Response } from 'express';
import { supabase } from './supabase';

type RouteRule = { method: string; pattern: RegExp };

// Paths are relative to the /api mount point.
const PUBLIC_ROUTES: RouteRule[] = [
  // Client share links are opened by external stakeholders without an account;
  // the share token itself is the credential.
  { method: 'GET', pattern: /^\/client\/share\/[^/]+$/ },
  { method: 'POST', pattern: /^\/client\/share\/[^/]+\/comments$/ },
];

// Routes where `user_id` names the user being acted on rather than the caller.
const TARGET_USER_ID_ROUTES: RouteRule[] = [
  { method: 'POST', pattern: /^\/projects\/[^/]+\/members$/ },
];

// Routes whose :userId/:id path segment must be the caller's own id.
const SELF_ONLY_ROUTES: RouteRule[] = [
  { method: 'GET', pattern: /^\/notifications\/([^/]+)$/ },
  { method: 'PATCH', pattern: /^\/notifications\/([^/]+)\/(read-all|preferences)$/ },
  { method: 'GET', pattern: /^\/calendar\/([^/]+)\/status$/ },
  { method: 'PATCH', pattern: /^\/calendar\/([^/]+)\/settings$/ },
  { method: 'DELETE', pattern: /^\/calendar\/([^/]+)\/[^/]+$/ },
  { method: 'PATCH', pattern: /^\/users\/([^/]+)$/ },
  { method: 'POST', pattern: /^\/users\/([^/]+)\/(cv|avatar)$/ },
];

// Request fields that identify who is performing the action. The client used to
// supply these freely; they are now always replaced with the verified user.
const CALLER_FIELDS = ['actor_id', 'user_id', 'created_by'] as const;

const TOKEN_CACHE_TTL_MS = 60_000;
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, { userId: string; expiresAt: number }>();

const matches = (rules: RouteRule[], req: Request) =>
  rules.find((rule) => rule.method === req.method && rule.pattern.test(req.path));

async function resolveUserId(token: string): Promise<string | null> {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.clear();
  tokenCache.set(token, { userId: data.user.id, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  return data.user.id;
}

function bindCallerFields(req: Request, userId: string) {
  const keepUserId = Boolean(matches(TARGET_USER_ID_ROUTES, req));
  const overwrite = (source: Record<string, unknown>) => {
    for (const field of CALLER_FIELDS) {
      if (field === 'user_id' && keepUserId) continue;
      if (field in source) source[field] = userId;
    }
  };

  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    overwrite(req.body as Record<string, unknown>);
  }
  // Express 5 re-parses req.query on every access, so pin a corrected copy.
  const query = { ...(req.query as Record<string, unknown>) };
  overwrite(query);
  Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true, enumerable: true });
}

export function clearAuthCache() {
  tokenCache.clear();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'OPTIONS' || matches(PUBLIC_ROUTES, req)) return next();

  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const userId = await resolveUserId(token);
    if (!userId) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });

    const selfOnly = matches(SELF_ONLY_ROUTES, req);
    if (selfOnly) {
      const ownerId = req.path.match(selfOnly.pattern)?.[1];
      if (ownerId !== userId) return res.status(403).json({ error: 'You can only access your own account.' });
    }

    bindCallerFields(req, userId);
    res.locals.userId = userId;
    next();
  } catch (error) {
    console.error('[auth] token verification failed', error);
    res.status(503).json({ error: 'Could not verify your session. Please try again.' });
  }
}
