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

const HOUR_TICK_STEP = 2;
const MAX_DAY_TICKS = 6;
const DAY_TICK_STEPS = [1, 2, 5, 10, 20, 50, 100];
/** The deadline stays on the axis unless it is this many times further out than the work. */
const DEADLINE_ZOOM_RATIO = 3;

export interface TimelineTick {
  hour: number;
  label: string;
}

export interface TimelineScale {
  spanHours: number;
  ticks: TimelineTick[];
  /** False when the deadline is far beyond the work, so the axis shows the work instead. */
  deadlineInView: boolean;
}

/**
 * Axis for the run timeline. Agents finish in hours, so a 90-day deadline would squeeze
 * all the work into a sliver: the axis covers whole working days up to the latest work,
 * stretches to the deadline only when it is close, and labels hours on a one-day axis.
 */
export function timelineScale(lastHour: number, deadlineDays: number, dayWord: string): TimelineScale {
  const workHours = Math.max(1, Math.ceil(lastHour / HOURS_PER_DAY)) * HOURS_PER_DAY;
  const deadlineHours = deadlineDays * HOURS_PER_DAY;
  const deadlineInView = deadlineHours <= workHours * DEADLINE_ZOOM_RATIO;
  const spanHours = deadlineInView ? Math.max(workHours, deadlineHours) : workHours;
  const ticks = spanHours <= HOURS_PER_DAY ? hourTicks(spanHours) : dayTicks(spanHours / HOURS_PER_DAY, dayWord);
  return { spanHours, ticks, deadlineInView };
}

function hourTicks(spanHours: number): TimelineTick[] {
  return Array.from({ length: Math.ceil(spanHours / HOUR_TICK_STEP) }, (_, index) => {
    const hour = index * HOUR_TICK_STEP;
    return { hour, label: `${WORKDAY_START_HOUR + hour}:00` };
  });
}

function dayTicks(days: number, dayWord: string): TimelineTick[] {
  const step = DAY_TICK_STEPS.find((candidate) => Math.ceil(days / candidate) <= MAX_DAY_TICKS) ?? DAY_TICK_STEPS[DAY_TICK_STEPS.length - 1] ?? 1;
  return Array.from({ length: Math.ceil(days / step) }, (_, index) => {
    const day = 1 + index * step;
    return { hour: (day - 1) * HOURS_PER_DAY, label: index === 0 ? `${dayWord} ${day}` : String(day) };
  });
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
