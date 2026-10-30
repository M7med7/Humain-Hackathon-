import type { Task } from "./api";

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  phone?: string;
  storyPoints: number;
  avatar: string;
  avatar_url?: string | null;
  taskCount: number;
  projectCount: number;
  completedCount: number;
  completedTasks: Array<{ id: string; title: string; project_name: string | null }>;
  gradient: string;
  isLocal: boolean;
  skills: string[];
  experienceSummary: string | null;
  cvParsedAt: string | null;
}

export function computeCapacity(storyPoints: number, maxSP: number): number {
  return Math.min(Math.round((storyPoints / maxSP) * 100), 100);
}

export function getInitials(fullName: string | null | undefined, email: string): string {
  if (fullName) {
    return fullName.trim().split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  }
  return email.slice(0, 2).toUpperCase();
}

export function computeLevelInfo(completedCount: number): { level: number; progress: number } {
  return {
    level: Math.floor(completedCount / 5) + 1,
    progress: ((completedCount % 5) / 5) * 100,
  };
}

// ─── Workload & Forecast ──────────────────────────────────────────────────────

function weekBounds(weekOffset = 0): { start: number; end: number } {
  const now = new Date();
  const sun = new Date(now);
  sun.setDate(now.getDate() - now.getDay() + weekOffset * 7);
  sun.setHours(0, 0, 0, 0);
  const sat = new Date(sun);
  sat.setDate(sat.getDate() + 6);
  sat.setHours(23, 59, 59, 999);
  return { start: sun.getTime(), end: sat.getTime() };
}

export function weeklyLoad(tasks: Task[], userId: string, weekOffset = 0): number {
  const { start, end } = weekBounds(weekOffset);
  return tasks
    .filter((t) => {
      if (t.assigned_to !== userId || t.status === "Done") return false;
      if (t.start_date && t.end_date) {
        const tS = new Date(t.start_date).getTime();
        const tE = new Date(t.end_date).getTime();
        return tS <= end && tE >= start;
      }
      return weekOffset === 0;
    })
    .reduce((sum, t) => sum + t.estimated_days, 0);
}

export function workloadForecast(
  tasks: Task[],
  userId: string,
  weeksCount = 5
): Array<{ label: string; load: number }> {
  return Array.from({ length: weeksCount }).map((_, i) => ({
    label: i === 0 ? "Now" : `W+${i}`,
    load: weeklyLoad(tasks, userId, i),
  }));
}

// ─── Skill Analysis ───────────────────────────────────────────────────────────

export function skillMatchScore(memberSkills: string[], taskTech: string[]): number {
  if (taskTech.length === 0) return 50;
  if (memberSkills.length === 0) return 0;
  const lower = memberSkills.map((s) => s.toLowerCase());
  const matched = taskTech.filter((t) =>
    lower.some((s) => s.includes(t.toLowerCase()) || t.toLowerCase().includes(s))
  ).length;
  return Math.round((matched / taskTech.length) * 100);
}

export function avgSkillMatch(memberSkills: string[], tasks: Task[], userId: string): number {
  const assigned = tasks.filter((t) => t.assigned_to === userId && t.assigned_tech.length > 0);
  if (assigned.length === 0) return -1;
  const total = assigned.reduce((sum, t) => sum + skillMatchScore(memberSkills, t.assigned_tech), 0);
  return Math.round(total / assigned.length);
}

export function skillGapDetection(
  members: Array<{ skills: string[] }>,
  tasks: Task[]
): Array<{ skill: string; tasks: string[] }> {
  const allSkills = new Set(members.flatMap((m) => m.skills.map((s) => s.toLowerCase())));
  const gapMap = new Map<string, string[]>();
  tasks
    .filter((t) => t.status !== "Done")
    .forEach((t) =>
      t.assigned_tech.forEach((tech) => {
        const key = tech.toLowerCase();
        if (!allSkills.has(key)) {
          const prev = gapMap.get(key) ?? [];
          if (!prev.includes(t.title)) gapMap.set(key, [...prev, t.title]);
        }
      })
    );
  return Array.from(gapMap.entries()).map(([skill, taskTitles]) => ({ skill, tasks: taskTitles }));
}

// ─── Overload Reasons ─────────────────────────────────────────────────────────

export interface OverloadReason { message: string; }

export function overloadReasons(
  member: Pick<TeamMember, "storyPoints" | "taskCount">,
  tasks: Task[],
  userId: string,
  maxSP: number
): OverloadReason[] {
  const reasons: OverloadReason[] = [];
  if (member.storyPoints > maxSP)
    reasons.push({ message: `${member.storyPoints - maxSP} SP over capacity limit` });
  if (member.taskCount > 5)
    reasons.push({ message: `${member.taskCount} concurrent tasks assigned` });
  const { start, end } = weekBounds(0);
  const dueCount = tasks.filter(
    (t) =>
      t.assigned_to === userId &&
      t.status !== "Done" &&
      t.end_date &&
      new Date(t.end_date).getTime() >= start &&
      new Date(t.end_date).getTime() <= end
  ).length;
  if (dueCount > 0) reasons.push({ message: `${dueCount} task${dueCount > 1 ? "s" : ""} due this week` });
  return reasons.slice(0, 2);
}

// ─── Suggested Owner ──────────────────────────────────────────────────────────

export function suggestOwner(
  task: Task,
  members: TeamMember[],
  maxSP: number,
  perMemberMaxSP: Record<string, number>
): { member: TeamMember; skillScore: number; capacityPct: number } | null {
  const candidates = members
    .filter((m) => !m.isLocal && m.id !== task.assigned_to)
    .map((m) => {
      const eff = perMemberMaxSP[m.id] ?? maxSP;
      const skillScore = skillMatchScore(m.skills, task.assigned_tech);
      const capacityPct = Math.max(0, 100 - computeCapacity(m.storyPoints, eff));
      return { member: m, skillScore, capacityPct, score: skillScore * 0.6 + capacityPct * 0.4 };
    })
    .sort((a, b) => b.score - a.score);
  if (!candidates[0]) return null;
  return {
    member: candidates[0].member,
    skillScore: candidates[0].skillScore,
    capacityPct: Math.round(candidates[0].capacityPct),
  };
}

// ─── Delivery Momentum ────────────────────────────────────────────────────────

export function deliveryMomentum(completedCount: number, taskCount: number): {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
} {
  const total = completedCount + taskCount;
  if (total < 2)
    return { label: "New", color: "text-gray-400", bgColor: "bg-gray-800/40", borderColor: "border-gray-600/30" };
  const rate = completedCount / total;
  if (rate >= 0.65)
    return { label: "Momentum", color: "text-emerald-400", bgColor: "bg-emerald-900/20", borderColor: "border-emerald-500/30" };
  if (rate >= 0.35)
    return { label: "Steady", color: "text-amber-400", bgColor: "bg-amber-900/20", borderColor: "border-amber-500/30" };
  return { label: "Ramping", color: "text-sky-400", bgColor: "bg-sky-900/20", borderColor: "border-sky-500/30" };
}
