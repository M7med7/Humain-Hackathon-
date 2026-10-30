import type { LlmCall, Run, RunTask } from './types';

export const HOURS_PER_DAY = 8;
const WORKDAY_START_HOUR = 9;

/** Simulated working hours → "Day 2 · 11:30". */
export function clockLabel(hour: number, dayWord: string): string {
  const day = Math.floor(hour / HOURS_PER_DAY) + 1;
  const minutes = Math.round((hour % HOURS_PER_DAY) * 60);
  const hh = WORKDAY_START_HOUR + Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(2, '0');
  return `${dayWord} ${day} · ${hh}:${mm}`;
}

export function deliveryDay(tasks: readonly RunTask[]): number {
  const last = Math.max(0, ...tasks.map((task) => task.finishedAtHour ?? 0));
  return Math.max(1, Math.ceil(last / HOURS_PER_DAY));
}

export function currentHour(run: Run): number {
  return run.events.at(-1)?.hour ?? 0;
}

export const isFinished = (task: RunTask): boolean => task.status === 'done' || task.status === 'cancelled' || task.status === 'failed';

export interface Spend {
  calls: number;
  tokens: number;
  cachedTokens: number;
  costUsd: number;
  /** Share of calls answered by the cheapest tier. */
  liteShare: number;
}

export function spend(calls: readonly LlmCall[]): Spend {
  const tokens = calls.reduce((sum, call) => sum + call.inputTokens + call.outputTokens + call.thinkingTokens, 0);
  return {
    calls: calls.length,
    tokens,
    cachedTokens: calls.reduce((sum, call) => sum + call.cachedTokens, 0),
    costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
    liteShare: calls.length === 0 ? 0 : calls.filter((call) => call.model.includes('lite')).length / calls.length,
  };
}

export function money(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function compact(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(value);
}

/** Hour each task first appeared in the activity feed (when work or a request started). */
export function startHours(run: Run): Map<string, number> {
  const starts = new Map<string, number>();
  for (const event of run.events) {
    if (event.taskId && !starts.has(event.taskId) && (event.type === 'working' || event.type === 'asked_person')) starts.set(event.taskId, event.hour);
  }
  return starts;
}
