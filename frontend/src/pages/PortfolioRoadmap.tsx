import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Download,
  Filter,
  Flag,
  Link2,
  Share2,
  Users,
} from "lucide-react";
import { api, type PortfolioProject, type PortfolioWorkload, type RiskLevel } from "../lib/api";
import { useTranslation } from "react-i18next";

type RoadmapFilters = {
  projectId: string;
  owner: string;
  status: string;
  risk: string;
  from: string;
  to: string;
};

type DeadlineConflict = {
  first: PortfolioProject;
  second: PortfolioProject;
  daysApart: number;
};

const riskStyles: Record<RiskLevel, string> = {
  Low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  Medium: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  High: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  Critical: "border-red-500/30 bg-red-500/10 text-red-300",
};

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "Not scheduled";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const first = toDate(a);
  const second = toDate(b);
  if (!first || !second) return null;
  return Math.abs(Math.round((first.getTime() - second.getTime()) / 86_400_000));
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getTimelineBounds(projects: PortfolioProject[]) {
  const dates = projects.flatMap((project) => [toDate(project.start_date), toDate(project.end_date)]).filter((date): date is Date => Boolean(date));
  if (dates.length === 0) {
    const today = new Date();
    return { start: today, end: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30) };
  }
  return {
    start: new Date(Math.min(...dates.map((date) => date.getTime()))),
    end: new Date(Math.max(...dates.map((date) => date.getTime()))),
  };
}

function getBarStyle(project: PortfolioProject, start: Date, end: Date) {
  const projectStart = toDate(project.start_date) ?? start;
  const projectEnd = toDate(project.end_date) ?? projectStart;
  const total = Math.max(1, end.getTime() - start.getTime());
  const left = Math.max(0, ((projectStart.getTime() - start.getTime()) / total) * 100);
  const width = Math.max(5, ((projectEnd.getTime() - projectStart.getTime()) / total) * 100);
  return { left: `${Math.min(95, left)}%`, width: `${Math.min(100 - left, width)}%` };
}

function findDeadlineConflicts(projects: PortfolioProject[]): DeadlineConflict[] {
  const conflicts: DeadlineConflict[] = [];
  const scheduled = projects.filter((project) => project.end_date && project.status !== "Done");
  for (let i = 0; i < scheduled.length; i += 1) {
    for (let j = i + 1; j < scheduled.length; j += 1) {
      const daysApart = daysBetween(scheduled[i].end_date, scheduled[j].end_date);
      if (daysApart !== null && daysApart <= 3) {
        conflicts.push({ first: scheduled[i], second: scheduled[j], daysApart });
      }
    }
  }
  return conflicts.slice(0, 5);
}

export function PortfolioRoadmap() {
  const { t } = useTranslation("reports");
  const [projects, setProjects] = useState<PortfolioProject[]>([]);
  const [workload, setWorkload] = useState<PortfolioWorkload[]>([]);
  const [filters, setFilters] = useState<RoadmapFilters>({
    projectId: "",
    owner: "",
    status: "",
    risk: "",
    from: "",
    to: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  useEffect(() => {
    api.portfolio
      .roadmap()
      .then((data) => {
        setProjects(data.projects);
        setWorkload(data.workload);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load roadmap"))
      .finally(() => setLoading(false));
  }, []);

  const owners = useMemo(() => {
    const names = new Set(projects.map((project) => project.owner_name).filter((name): name is string => Boolean(name)));
    return Array.from(names).sort();
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const from = filters.from ? new Date(filters.from) : null;
    const to = filters.to ? new Date(filters.to) : null;
    return projects.filter((project) => {
      if (filters.projectId && project.id !== filters.projectId) return false;
      if (filters.owner && project.owner_name !== filters.owner) return false;
      if (filters.status && project.status !== filters.status) return false;
      if (filters.risk && project.risk_level !== filters.risk) return false;
      const start = toDate(project.start_date);
      const end = toDate(project.end_date);
      if (from && end && end < from) return false;
      if (to && start && start > to) return false;
      return true;
    });
  }, [projects, filters]);

  const sortedProjects = useMemo(() => {
    const riskRank: Record<RiskLevel, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    return [...filteredProjects].sort((a, b) => {
      if (riskRank[a.risk_level] !== riskRank[b.risk_level]) return riskRank[a.risk_level] - riskRank[b.risk_level];
      if (b.overdue_count !== a.overdue_count) return b.overdue_count - a.overdue_count;
      return String(a.end_date ?? "").localeCompare(String(b.end_date ?? ""));
    });
  }, [filteredProjects]);

  const timelineBounds = useMemo(() => getTimelineBounds(sortedProjects), [sortedProjects]);
  const conflicts = useMemo(() => findDeadlineConflicts(sortedProjects), [sortedProjects]);
  const overloadedMembers = workload.filter((member) => member.overloaded);
  const riskyProjects = filteredProjects.filter((project) => project.risk_level === "Critical" || project.risk_level === "High");
  const overdueTotal = filteredProjects.reduce((sum, project) => sum + project.overdue_count, 0);
  const blockedTotal = filteredProjects.reduce((sum, project) => sum + project.blocked_count, 0);

  const updateFilter = (key: keyof RoadmapFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const exportRoadmap = () => {
    downloadCsv("portfolio-roadmap.csv", [
      ["Project", "Status", "Owner", "Risk", "Health", "Progress", "Start", "Deadline", "Tasks", "Overdue", "Blocked", "High Priority"],
      ...sortedProjects.map((project) => [
        project.name,
        project.status,
        project.owner_name ?? "",
        project.risk_level,
        `${project.health_score}%`,
        `${project.progress}%`,
        project.start_date ?? "",
        project.end_date ?? "",
        String(project.task_count),
        String(project.overdue_count),
        String(project.blocked_count),
        String(project.high_priority_count),
      ]),
      [],
      ["Team Member", "Open Tasks", "Estimated Days", "Projects", "Overloaded"],
      ...workload.map((member) => [
        member.name,
        String(member.open_tasks),
        String(member.estimated_days),
        String(member.project_count),
        member.overloaded ? "Yes" : "No",
      ]),
    ]);
  };

  const shareRoadmap = async () => {
    const text = `Portfolio roadmap: ${filteredProjects.length} projects, ${riskyProjects.length} high-risk, ${overdueTotal} overdue tasks.`;
    try {
      await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
      setShareStatus("Summary link copied");
    } catch {
      setShareStatus("Use the export button to share this view");
    }
    window.setTimeout(() => setShareStatus(null), 2500);
  };

  if (loading) {
    return (
      <div className="min-h-full p-8">
        <div className="mx-auto max-w-7xl">
          <div className="h-8 w-64 animate-pulse rounded bg-white/10" />
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl border border-white/10 bg-white/5" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3 text-sm text-purple-300">
              <CalendarDays className="h-4 w-4" />
              {t("roadmap.eyebrow")}
            </div>
            <h1 className="mt-2 text-3xl font-semibold text-white">{t("roadmap.title")}</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-400">
              {t("roadmap.description")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={shareRoadmap}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 transition-colors hover:border-purple-500/40 hover:text-white"
            >
              <Share2 className="h-4 w-4" />
              {t("roadmap.share")}
            </button>
            <button
              onClick={exportRoadmap}
              className="inline-flex items-center gap-2 rounded-xl border border-purple-500/40 bg-purple-600/20 px-4 py-2 text-sm font-medium text-purple-100 transition-colors hover:bg-purple-600/30"
            >
              <Download className="h-4 w-4" />
              {t("roadmap.export")}
            </button>
          </div>
        </div>

        {shareStatus && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {shareStatus}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 app-input p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">{t("roadmap.needsAttention")}</div>
            <div className="mt-2 text-3xl font-semibold text-white">{riskyProjects.length}</div>
            <div className="mt-1 text-sm text-gray-400">{t("roadmap.needsAttentionHelp")}</div>
          </div>
          <div className="rounded-2xl border border-white/10 app-input p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">{t("roadmap.blockedOverdue")}</div>
            <div className="mt-2 text-3xl font-semibold text-white">{blockedTotal + overdueTotal}</div>
            <div className="mt-1 text-sm text-gray-400">{blockedTotal} blocked, {overdueTotal} overdue</div>
          </div>
          <div className="rounded-2xl border border-white/10 app-input p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">{t("roadmap.deadlineConflicts")}</div>
            <div className="mt-2 text-3xl font-semibold text-white">{conflicts.length}</div>
            <div className="mt-1 text-sm text-gray-400">{t("roadmap.deadlineHelp")}</div>
          </div>
          <div className="rounded-2xl border border-white/10 app-input p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">{t("roadmap.overload")}</div>
            <div className="mt-2 text-3xl font-semibold text-white">{overloadedMembers.length}</div>
            <div className="mt-1 text-sm text-gray-400">{t("roadmap.overloadHelp")}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 app-panel p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-300">
            <Filter className="h-4 w-4 text-purple-300" />
            {t("roadmap.filters")}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <select value={filters.projectId} onChange={(e) => updateFilter("projectId", e.target.value)} className="rounded-xl border border-white/10 app-input px-3 py-2 text-sm text-gray-200">
              <option value="">{t("roadmap.allProjects")}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <select value={filters.owner} onChange={(e) => updateFilter("owner", e.target.value)} className="rounded-xl border border-white/10 app-input px-3 py-2 text-sm text-gray-200">
              <option value="">{t("roadmap.allOwners")}</option>
              {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
            </select>
            <select value={filters.status} onChange={(e) => updateFilter("status", e.target.value)} className="rounded-xl border border-white/10 app-input px-3 py-2 text-sm text-gray-200">
              <option value="">{t("roadmap.allStatuses")}</option>
              <option value="Planning">{t("roadmap.status.Planning")}</option>
              <option value="Active">{t("roadmap.status.Active")}</option>
              <option value="Completed">{t("roadmap.status.Completed")}</option>
              <option value="Done">{t("roadmap.status.Done")}</option>
            </select>
            <select value={filters.risk} onChange={(e) => updateFilter("risk", e.target.value)} className="rounded-xl border border-white/10 app-input px-3 py-2 text-sm text-gray-200">
              <option value="">{t("roadmap.allRisk")}</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
            <input type="date" value={filters.from} onChange={(e) => updateFilter("from", e.target.value)} className="rounded-xl border border-white/10 app-input px-3 py-2 text-sm text-gray-200" />
            <input type="date" value={filters.to} onChange={(e) => updateFilter("to", e.target.value)} className="rounded-xl border border-white/10 app-input px-3 py-2 text-sm text-gray-200" />
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-white/10 app-panel">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-lg font-semibold text-white">{t("roadmap.activeTimelines")}</h2>
              <p className="mt-1 text-sm text-gray-500">{formatDate(timelineBounds.start.toISOString())} to {formatDate(timelineBounds.end.toISOString())}</p>
            </div>

            {sortedProjects.length === 0 ? (
              <div className="p-10 text-center text-sm text-gray-500">{t("roadmap.noMatches")}</div>
            ) : (
              <div className="divide-y divide-white/10">
                {sortedProjects.map((project) => {
                  const projectConflicts = conflicts.filter((item) => item.first.id === project.id || item.second.id === project.id);
                  return (
                    <div key={project.id} className="p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                        <div className="min-w-0 lg:w-72">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link to={`/task/${project.id}`} className="truncate text-base font-semibold text-white hover:text-purple-200">
                              {project.name}
                            </Link>
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${riskStyles[project.risk_level]}`}>
                              {project.risk_level}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-xs text-gray-500">
                            {project.owner_name ?? t("roadmap.noOwner")} • {t("roadmap.complete", { count: project.progress })} • {t("roadmap.tasks", { count: project.task_count })}
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="relative h-12 rounded-xl border border-white/10 bg-white/[0.03]">
                            <div
                              className="absolute top-3 h-6 rounded-lg border border-purple-400/40 bg-purple-500/25 shadow-lg shadow-purple-900/30"
                              style={getBarStyle(project, timelineBounds.start, timelineBounds.end)}
                            >
                              <div className="h-full rounded-lg bg-purple-300/30" style={{ width: `${project.progress}%` }} />
                            </div>
                            {project.milestones.map((milestone) => {
                              const due = toDate(milestone.due_date);
                              if (!due) return null;
                              const total = Math.max(1, timelineBounds.end.getTime() - timelineBounds.start.getTime());
                              const left = Math.max(0, Math.min(98, ((due.getTime() - timelineBounds.start.getTime()) / total) * 100));
                              return (
                                <span
                                  key={milestone.id}
                                  title={`${milestone.title} • ${formatDate(milestone.due_date)}`}
                                  className={`absolute top-1 h-10 w-1 rounded-full ${milestone.blocked ? "bg-red-400" : milestone.status === "Done" ? "bg-emerald-400" : "bg-amber-300"}`}
                                  style={{ left: `${left}%` }}
                                />
                              );
                            })}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className="text-gray-500">{formatDate(project.start_date)} → {formatDate(project.end_date)}</span>
                            {project.overdue_count > 0 && <span className="text-red-300">{project.overdue_count} overdue</span>}
                            {project.blocked_count > 0 && <span className="text-amber-300">{project.blocked_count} blocked</span>}
                            {projectConflicts.length > 0 && <span className="text-purple-300">{t("roadmap.deadlineConflict")}</span>}
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-center lg:w-48">
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2">
                            <div className="text-sm font-semibold text-white">{project.health_score}%</div>
                            <div className="text-[10px] uppercase text-gray-500">{t("roadmap.health")}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2">
                            <div className="text-sm font-semibold text-white">{project.blocked_count}</div>
                            <div className="text-[10px] uppercase text-gray-500">{t("roadmap.blocked")}</div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2">
                            <div className="text-sm font-semibold text-white">{project.overdue_count}</div>
                            <div className="text-[10px] uppercase text-gray-500">{t("roadmap.late")}</div>
                          </div>
                        </div>
                      </div>

                      {project.milestones.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {project.milestones.slice(0, 4).map((milestone) => (
                            <span key={milestone.id} className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-gray-300">
                              <Flag className="h-3 w-3 text-purple-300" />
                              <span className="truncate">{milestone.title}</span>
                              <span className="text-gray-500">{formatDate(milestone.due_date)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 app-panel p-5">
              <div className="mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-300" />
                <h2 className="font-semibold text-white">{t("roadmap.whatNeedsAttention")}</h2>
              </div>
              <div className="space-y-3">
                {riskyProjects.slice(0, 4).map((project) => (
                  <Link key={project.id} to={`/task/${project.id}`} className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:border-purple-500/40">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-white">{project.name}</span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${riskStyles[project.risk_level]}`}>{project.risk_level}</span>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">{project.blocked_count} blocked • {project.overdue_count} overdue • {project.high_priority_count} high priority</div>
                  </Link>
                ))}
                {riskyProjects.length === 0 && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-200">
                    {t("roadmap.noHighRisk")}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 app-panel p-5">
              <div className="mb-4 flex items-center gap-2">
                <Link2 className="h-4 w-4 text-purple-300" />
                <h2 className="font-semibold text-white">{t("roadmap.deadlineConflicts")}</h2>
              </div>
              <div className="space-y-3">
                {conflicts.map((conflict) => (
                  <div key={`${conflict.first.id}-${conflict.second.id}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-sm text-white">{conflict.first.name}</div>
                    <div className="text-sm text-white">{conflict.second.name}</div>
                    <div className="mt-1 text-xs text-gray-500">Deadlines are {conflict.daysApart === 0 ? "same day" : `${conflict.daysApart} days apart`}</div>
                  </div>
                ))}
                {conflicts.length === 0 && <div className="text-sm text-gray-500">{t("roadmap.noConflicts")}</div>}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 app-panel p-5">
              <div className="mb-4 flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-300" />
                <h2 className="font-semibold text-white">{t("roadmap.workload")}</h2>
              </div>
              <div className="space-y-3">
                {workload.length === 0 ? (
                  <div className="text-sm text-gray-500">{t("roadmap.noWork")}</div>
                ) : (
                  workload
                    .slice()
                    .sort((a, b) => Number(b.overloaded) - Number(a.overloaded) || b.estimated_days - a.estimated_days)
                    .slice(0, 8)
                    .map((member) => (
                      <div key={member.user_id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white">{member.name}</div>
                            <div className="text-xs text-gray-500">{member.project_count} projects • {member.open_tasks} open tasks</div>
                          </div>
                          {member.overloaded ? (
                            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">{t("roadmap.overloaded")}</span>
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                          )}
                        </div>
                        <div className="mt-3 h-2 rounded-full bg-white/10">
                          <div className={`h-2 rounded-full ${member.overloaded ? "bg-red-400" : "bg-purple-400"}`} style={{ width: `${Math.min(100, (member.estimated_days / 14) * 100)}%` }} />
                        </div>
                        <div className="mt-1 text-xs text-gray-500">{member.estimated_days.toFixed(1)} estimated days active</div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
