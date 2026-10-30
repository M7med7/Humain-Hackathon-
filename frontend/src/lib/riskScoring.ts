import type { Project, ProjectMember, RiskLevel, Task } from "./api";
import type { ScheduleInfo } from "./schedule";

export interface RiskResult {
  score: number;
  level: RiskLevel;
  reasons: string[];
  actions: string[];
}

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 85) return "Critical";
  if (score >= 60) return "High";
  if (score >= 30) return "Medium";
  return "Low";
}

function addRisk(
  state: { score: number; reasons: string[]; actions: string[] },
  points: number,
  reason: string,
  action: string,
) {
  state.score += points;
  state.reasons.push(reason);
  if (!state.actions.includes(action)) state.actions.push(action);
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasSkillMismatch(task: Task, member?: ProjectMember): boolean {
  const required = (task.assigned_tech ?? []).map(norm).filter(Boolean);
  if (required.length === 0 || !member) return false;
  const memberSkills = (member.skills ?? []).map(norm);
  if (memberSkills.length === 0) return true;
  return required.every((skill) => !memberSkills.some((memberSkill) => memberSkill.includes(skill) || skill.includes(memberSkill)));
}

export function scoreTaskRisk(
  task: Task,
  options: {
    schedule?: ScheduleInfo | null;
    members: ProjectMember[];
    allTasks: Task[];
  },
): RiskResult {
  const state = { score: 0, reasons: [] as string[], actions: [] as string[] };
  const today = startOfToday();
  const scheduleEnd = options.schedule?.end ?? (task.end_date ? new Date(task.end_date) : null);
  const assignee = options.members.find((member) => member.user_id === task.assigned_to);
  const projectTasks = options.allTasks.filter((item) => item.project_id === task.project_id);
  const assignedOpenDays = task.assigned_to
    ? projectTasks
        .filter((item) => item.assigned_to === task.assigned_to && item.status !== "Done")
        .reduce((sum, item) => sum + Number(item.estimated_days || 0), 0)
    : 0;

  if (task.status !== "Done" && scheduleEnd && scheduleEnd < today) {
    addRisk(state, 35, "Task is overdue.", "Move the due date, reduce scope, or assign immediate help.");
  }
  if (task.is_blocked) {
    addRisk(state, 25, `Blocked by ${task.blocking_count ?? 1} unfinished prerequisite${(task.blocking_count ?? 1) === 1 ? "" : "s"}.`, "Finish or reassign the blocking work first.");
  }
  if (!task.assigned_to) {
    addRisk(state, 20, "No owner is assigned.", "Assign one accountable owner.");
  }
  if (assignedOpenDays > 10) {
    addRisk(state, 18, `${assignee?.full_name ?? assignee?.email ?? "Assignee"} has ${assignedOpenDays} open estimated days.`, "Rebalance work or split the task.");
  }
  if (task.priority === "High") {
    addRisk(state, 8, "Task is high priority.", "Confirm it belongs on the critical path.");
  }
  if ((task.blocked_by ?? []).length === 0 && task.title.toLowerCase().match(/deploy|integrat|test|release|frontend|api/)) {
    addRisk(state, 10, "Likely dependency-sensitive task has no blockers listed.", "Add prerequisite tasks so the schedule reflects real order.");
  }
  if (!task.latest_activity_at || Date.now() - new Date(task.latest_activity_at).getTime() > 7 * 86_400_000) {
    addRisk(state, 12, "No recent activity in the last 7 days.", "Ask for a short update or break the task into a smaller next step.");
  }
  if (Number(task.estimated_days || 0) > 5) {
    addRisk(state, 15, `Estimate is large at ${task.estimated_days} days.`, "Split into smaller 1-3 day tasks.");
  }
  if (hasSkillMismatch(task, assignee)) {
    addRisk(state, 18, "Assignee skills do not clearly match the task technology.", "Pair with a skilled teammate or reassign to a better fit.");
  }
  if (options.schedule?.hasDependencyWarning) {
    addRisk(state, 15, options.schedule.warning ?? "Schedule conflicts with dependencies.", "Move the task after its blockers finish.");
  }

  const score = Math.min(100, state.score);
  return {
    score,
    level: levelFromScore(score),
    reasons: state.reasons.length ? state.reasons : ["No major risk signals detected."],
    actions: state.actions.length ? state.actions : ["Keep progress visible with regular updates."],
  };
}

export function scoreProjectHealth(project: Project, tasks: Task[], members: ProjectMember[], schedules: Map<string, ScheduleInfo>): RiskResult {
  const state = { score: 0, reasons: [] as string[], actions: [] as string[] };
  const openTasks = tasks.filter((task) => task.status !== "Done");
  const highPriority = openTasks.filter((task) => task.priority === "High");
  const blocked = openTasks.filter((task) => task.is_blocked);
  const missingOwner = openTasks.filter((task) => !task.assigned_to);
  const overdue = openTasks.filter((task) => {
    const end = schedules.get(task.id)?.end ?? (task.end_date ? new Date(task.end_date) : null);
    return Boolean(end && end < startOfToday());
  });
  const totalOpenDays = openTasks.reduce((sum, task) => sum + Number(task.estimated_days || 0), 0);
  const durationCapacity = (project.duration_weeks ?? 0) > 0 ? (project.duration_weeks ?? 0) * 7 * Math.max(1, members.length) : 0;

  if (overdue.length > 0) addRisk(state, Math.min(35, overdue.length * 10), `${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}.`, "Review overdue work and reset dates or owners.");
  if (blocked.length > 0) addRisk(state, Math.min(25, blocked.length * 8), `${blocked.length} blocked task${blocked.length === 1 ? "" : "s"}.`, "Clear blockers before starting more work.");
  if (missingOwner.length > 0) addRisk(state, Math.min(20, missingOwner.length * 6), `${missingOwner.length} task${missingOwner.length === 1 ? " has" : "s have"} no owner.`, "Assign owners for unowned tasks.");
  if (durationCapacity > 0 && totalOpenDays > durationCapacity) addRisk(state, 20, "Open estimates exceed team timeline capacity.", "Reduce scope, extend timeline, or add capacity.");
  if (openTasks.length > 0 && highPriority.length / openTasks.length > 0.4) addRisk(state, 12, "More than 40% of open tasks are high priority.", "Separate true critical-path work from normal priority work.");
  if (openTasks.length > 3 && openTasks.filter((task) => (task.blocked_by ?? []).length === 0).length / openTasks.length > 0.8) addRisk(state, 10, "Most tasks have no dependencies.", "Add key dependencies for setup, integration, testing, and release.");

  const score = Math.min(100, state.score);
  return {
    score,
    level: levelFromScore(score),
    reasons: state.reasons.length ? state.reasons : ["Project is currently healthy."],
    actions: state.actions.length ? state.actions : ["Keep updating task status and blockers."],
  };
}

export function riskStyle(level: RiskLevel): string {
  if (level === "Critical") return "border-red-500/50 bg-red-900/35 text-red-200";
  if (level === "High") return "border-orange-500/45 bg-orange-900/25 text-orange-200";
  if (level === "Medium") return "border-yellow-500/40 bg-yellow-900/25 text-yellow-200";
  return "border-green-500/35 bg-green-900/20 text-green-200";
}
