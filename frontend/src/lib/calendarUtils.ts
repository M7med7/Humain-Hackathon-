import type { Task } from "./api";

export interface ScheduledTask {
  task: Task;
  start: Date;
  end: Date;
  hasDependencyWarning?: boolean;
}

export interface ProjectColorSet {
  bg: string;
  border: string;
  text: string;
  dot: string;
  ring: string;
}

const PALETTE: ProjectColorSet[] = [
  { bg: "bg-purple-600",  border: "border-purple-400/40",  text: "text-purple-200",  dot: "bg-purple-400",  ring: "ring-purple-400/60"  },
  { bg: "bg-emerald-600", border: "border-emerald-400/40", text: "text-emerald-200", dot: "bg-emerald-400", ring: "ring-emerald-400/60" },
  { bg: "bg-sky-600",     border: "border-sky-400/40",     text: "text-sky-200",     dot: "bg-sky-400",     ring: "ring-sky-400/60"     },
  { bg: "bg-amber-600",   border: "border-amber-400/40",   text: "text-amber-200",   dot: "bg-amber-400",   ring: "ring-amber-400/60"   },
  { bg: "bg-rose-600",    border: "border-rose-400/40",    text: "text-rose-200",    dot: "bg-rose-400",    ring: "ring-rose-400/60"    },
  { bg: "bg-indigo-600",  border: "border-indigo-400/40",  text: "text-indigo-200",  dot: "bg-indigo-400",  ring: "ring-indigo-400/60"  },
  { bg: "bg-teal-600",    border: "border-teal-400/40",    text: "text-teal-200",    dot: "bg-teal-400",    ring: "ring-teal-400/60"    },
  { bg: "bg-fuchsia-600", border: "border-fuchsia-400/40", text: "text-fuchsia-200", dot: "bg-fuchsia-400", ring: "ring-fuchsia-400/60" },
];

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0;
}

export function projectColors(projectId: string): ProjectColorSet {
  return PALETTE[djb2(projectId) % PALETTE.length];
}

export function startOfDayMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayLoad(date: Date, scheduled: ScheduledTask[]): number {
  const d = startOfDayMs(date);
  return scheduled.filter((s) => d >= startOfDayMs(s.start) && d <= startOfDayMs(s.end)).length;
}

export function buildConflictMap(scheduled: ScheduledTask[]): Map<string, string> {
  const conflicts = new Map<string, string>();
  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i];
      const b = scheduled[j];
      if (!a.task.assigned_to || a.task.assigned_to !== b.task.assigned_to) continue;
      const aS = startOfDayMs(a.start), aE = startOfDayMs(a.end);
      const bS = startOfDayMs(b.start), bE = startOfDayMs(b.end);
      if (aS <= bE && bS <= aE) {
        if (!conflicts.has(a.task.id)) conflicts.set(a.task.id, `Overlaps with "${b.task.title}"`);
        if (!conflicts.has(b.task.id)) conflicts.set(b.task.id, `Overlaps with "${a.task.title}"`);
      }
    }
  }
  return conflicts;
}

export const OVERLOAD_THRESHOLD = 4;
