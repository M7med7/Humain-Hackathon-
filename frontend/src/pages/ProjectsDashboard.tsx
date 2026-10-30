import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Clock, Users, Trash2, AlertTriangle, X, Activity, FileText,
  ArrowUpDown, Zap, CalendarClock, ChevronRight, FolderOpen, Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "../components/Button";
import { api, type Project, type HealthBadge } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "risk" | "deadline" | "progress" | "activity";
type FilterKey = "all" | "attention" | "blocked" | "delayed" | "healthy";

// ── Badge config ──────────────────────────────────────────────────────────────

const BADGE: Record<HealthBadge, { card: string; pill: string; bar: string; dot: string }> = {
  Blocked: {
    card: "border-l-red-500/60",
    pill: "bg-red-500/15 text-red-400 border-red-500/30",
    bar: "from-red-700 to-red-500",
    dot: "bg-red-400",
  },
  Delayed: {
    card: "border-l-orange-500/60",
    pill: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    bar: "from-orange-700 to-orange-500",
    dot: "bg-orange-400",
  },
  "At Risk": {
    card: "border-l-yellow-500/55",
    pill: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    bar: "from-yellow-700 to-yellow-500",
    dot: "bg-yellow-400",
  },
  Healthy: {
    card: "border-l-purple-500/40",
    pill: "bg-green-500/12 text-green-400 border-green-500/25",
    bar: "from-purple-700 to-purple-500",
    dot: "bg-green-400",
  },
};

const RISK_ORDER: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatNextDeadline(iso: string, language: string, t: TFunction): string {
  const d = new Date(iso);
  const diff = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return t("deadline.overdue", { count: Math.abs(diff) });
  if (diff === 0) return t("deadline.today");
  if (diff === 1) return t("deadline.tomorrow");
  if (diff <= 7) return t("deadline.inDays", { count: diff });
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric" }).format(d);
}

function sortProjects(list: Project[], key: SortKey): Project[] {
  return [...list].sort((a, b) => {
    if (key === "risk") return (RISK_ORDER[b.risk_level ?? "Low"] ?? 0) - (RISK_ORDER[a.risk_level ?? "Low"] ?? 0);
    if (key === "deadline") {
      if (!a.next_deadline && !b.next_deadline) return 0;
      if (!a.next_deadline) return 1;
      if (!b.next_deadline) return -1;
      return new Date(a.next_deadline).getTime() - new Date(b.next_deadline).getTime();
    }
    if (key === "progress") return (a.progress ?? 0) - (b.progress ?? 0);
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function filterProjects(list: Project[], key: FilterKey): Project[] {
  if (key === "all") return list;
  if (key === "attention") return list.filter((p) => p.health_badge === "Blocked" || p.health_badge === "Delayed" || p.health_badge === "At Risk");
  if (key === "blocked") return list.filter((p) => p.health_badge === "Blocked");
  if (key === "delayed") return list.filter((p) => p.health_badge === "Delayed");
  return list.filter((p) => p.health_badge === "Healthy" || !p.health_badge);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HealthPill({ badge, t }: { badge: HealthBadge | undefined; t: TFunction }) {
  const cfg = BADGE[badge ?? "Healthy"];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {t(`health.${badge ?? "Healthy"}`)}
    </span>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color: "red" | "orange" | "yellow" }) {
  const cls = {
    red: "text-red-400 bg-red-500/10 border-red-500/25",
    orange: "text-orange-400 bg-orange-500/10 border-orange-500/25",
    yellow: "text-yellow-400 bg-yellow-500/10 border-yellow-500/25",
  }[color];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function EmptyState({ onCreate, t }: { onCreate: () => void; t: TFunction }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center py-20 text-center"
    >
      <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl border border-purple-500/20 bg-purple-900/15">
        <Sparkles className="h-9 w-9 text-purple-400" />
      </div>
      <h3 className="mb-2 text-2xl font-light text-white">{t("empty.title")}</h3>
      <p className="mb-10 max-w-sm text-sm text-gray-500 leading-relaxed">
        {t("empty.description")}
      </p>
      <div className="mb-10 flex flex-col sm:flex-row gap-4 text-left max-w-lg w-full">
        {[
          { icon: "①", label: t("empty.describe"), sub: t("empty.describeHelp") },
          { icon: "②", label: t("empty.plan"), sub: t("empty.planHelp") },
          { icon: "③", label: t("empty.track"), sub: t("empty.trackHelp") },
        ].map(({ icon, label, sub }) => (
          <div key={icon} className="flex-1 rounded-xl border border-white/8 bg-white/3 p-4">
            <div className="mb-2 text-lg text-purple-400">{icon}</div>
            <p className="text-sm font-medium text-white">{label}</p>
            <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
          </div>
        ))}
      </div>
      <Button onClick={onCreate}>+ {t("createFirstProject")}</Button>
    </motion.div>
  );
}

function ConfirmDeleteModal({
  projectName, onConfirm, onCancel, deleting, t,
}: {
  projectName: string; onConfirm: () => void; onCancel: () => void; deleting: boolean; t: TFunction;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        className="w-full max-w-md rounded-2xl border border-red-500/40 app-surface-elevated p-6 shadow-2xl shadow-red-500/20"
      >
        <div className="mb-5 flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-900/50 border border-red-500/40">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">{t("delete.title")}</h3>
            <p className="mt-1 text-sm text-gray-400">
              {t("delete.description", { name: projectName })}
            </p>
          </div>
          <button onClick={onCancel} className="ml-auto rounded-lg border border-white/10 p-1.5 text-gray-400 hover:text-white hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} disabled={deleting} className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-white/5 hover:text-white disabled:opacity-40">
            {t("common:actions.cancel")}
          </button>
          <button onClick={onConfirm} disabled={deleting} className="rounded-xl bg-red-600 hover:bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-500/20 disabled:opacity-40 transition-colors">
            {deleting ? t("delete.deleting") : t("delete.action")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectsDashboard() {
  const { t, i18n } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();
  const { session } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("risk");
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    api.projects
      .list()
      .then(({ projects: p }) => setProjects(p))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async () => {
    if (!confirmId) return;
    setDeletingId(confirmId);
    try {
      await api.projects.delete(confirmId, session?.user.id);
      setProjects((prev) => prev.filter((p) => p.id !== confirmId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("projects:delete.failed"));
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  };

  const confirmProject = confirmId ? projects.find((p) => p.id === confirmId) : null;
  const displayed = filterProjects(sortProjects(projects, sort), filter);

  // Attention summary counts
  const attentionProjects = projects.filter((p) => p.health_badge && p.health_badge !== "Healthy");
  const totalOverdue = projects.reduce((s, p) => s + (p.overdue_count ?? 0), 0);
  const totalBlocked = projects.reduce((s, p) => s + (p.blocked_count ?? 0), 0);

  const filterCounts: Record<FilterKey, number> = {
    all: projects.length,
    attention: attentionProjects.length,
    blocked: projects.filter((p) => p.health_badge === "Blocked").length,
    delayed: projects.filter((p) => p.health_badge === "Delayed").length,
    healthy: projects.filter((p) => !p.health_badge || p.health_badge === "Healthy").length,
  };

  return (
    <div className="p-4 md:p-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h2 className="text-2xl md:text-3xl mb-1 font-light">{t("projects:title")}</h2>
          <p className="text-gray-500 text-sm">{t("projects:count", { count: projects.length })} · {t("projects:aiExecution")}</p>
        </div>
        <Button onClick={() => navigate("/create")} className="shrink-0 whitespace-nowrap">+ {t("projects:newProject")}</Button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 rounded-xl text-red-300 text-sm">{error}</div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-48 text-gray-500">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">{t("projects:loading")}</p>
          </div>
        </div>
      )}

      {!loading && !error && projects.length === 0 && (
        <EmptyState onCreate={() => navigate("/create")} t={t} />
      )}

      {!loading && projects.length > 0 && (
        <>
          {/* Attention banner */}
          <AnimatePresence>
            {attentionProjects.length > 0 && filter === "all" && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-orange-500/20 bg-orange-500/6 px-4 py-3"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-orange-400" />
                <span className="text-sm text-orange-300">
                  <span className="font-semibold">{t("projects:attention.projects", { count: attentionProjects.length })}</span>
                  {totalOverdue > 0 && <> · <span className="font-medium">{t("projects:attention.overdue", { count: totalOverdue })}</span></>}
                  {totalBlocked > 0 && <> · <span className="font-medium">{t("projects:attention.blocked", { count: totalBlocked })}</span></>}
                </span>
                <button
                  onClick={() => setFilter("attention")}
                  className="ml-auto flex items-center gap-1 text-xs text-orange-400 hover:text-orange-200 transition-colors"
                >
                  {t("projects:attention.showOnly")} <ChevronRight className="h-3 w-3 rtl:rotate-180" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Sort + Filter toolbar */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            {/* Sort */}
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-3.5 w-3.5 text-gray-600" />
              <div className="flex gap-1">
                {(["risk", "deadline", "progress", "activity"] as SortKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setSort(key)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      sort === key
                        ? "bg-purple-600/25 text-purple-300 border border-purple-500/35"
                        : "text-gray-500 hover:text-gray-300 border border-white/6 hover:border-white/12"
                    }`}
                  >
                    {t(`projects:sort.${key}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter — scrolls sideways on phones instead of overflowing */}
            <div className="flex max-w-full gap-1 overflow-x-auto sm:ms-auto">
              {(["all", "attention", "blocked", "delayed", "healthy"] as FilterKey[]).map((key) => {
                const count = filterCounts[key];
                const label = t(`projects:filters.${key}`);
                return (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      filter === key
                        ? "bg-purple-600/25 text-purple-300 border border-purple-500/35"
                        : "text-gray-500 hover:text-gray-300 border border-white/6 hover:border-white/12"
                    }`}
                  >
                    {label}
                    {count > 0 && (
                      <span className={`rounded-full px-1.5 text-[9px] font-bold ${filter === key ? "bg-purple-500/30 text-purple-300" : "bg-white/8 text-gray-500"}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Empty filter result */}
          {displayed.length === 0 && (
            <div className="py-16 text-center text-gray-500">
              <p className="text-sm">{t("projects:noFilterResults")}</p>
              <button onClick={() => setFilter("all")} className="mt-3 text-xs text-purple-400 hover:text-purple-300">{t("projects:clearFilter")}</button>
            </div>
          )}

          {/* Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
            {displayed.map((project, index) => {
              const badge = project.health_badge ?? "Healthy";
              const cfg = BADGE[badge];
              const hasWarnings = (project.overdue_count ?? 0) > 0 || (project.blocked_count ?? 0) > 0 || project.overload_warning;

              return (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  whileHover={{ y: -3 }}
                  className="group"
                >
                  <div className={`flex flex-col rounded-xl border border-white/10 border-l-4 ${cfg.card} bg-white/3 backdrop-blur-sm hover:border-white/15 transition-all duration-300 overflow-hidden`}>

                    {/* Card body — links to project */}
                    <Link to={`/task/${project.id}`} className="flex flex-col gap-3 p-5 flex-1">
                      {/* Row 1: badge + index */}
                      <div className="flex items-center justify-between">
                        <HealthPill badge={badge} t={t} />
                        <span className="text-xs font-medium text-white/30">{String(index + 1).padStart(2, "0")}</span>
                      </div>

                      {/* Row 2: Project name */}
                      <h3 className="text-base font-semibold text-white leading-snug group-hover:text-purple-100 transition-colors">
                        {project.name}
                      </h3>

                      {/* Row 3: Description */}
                      <p className="text-sm text-gray-500 leading-relaxed line-clamp-2 flex-1">
                        {project.description}
                      </p>

                      {/* Row 4: Warning chips (only if present) */}
                      {hasWarnings && (
                        <div className="flex flex-wrap gap-1.5">
                          {(project.overdue_count ?? 0) > 0 && (
                            <Chip color="orange">
                              <Clock className="h-2.5 w-2.5" />
                              {t("projects:overdue", { count: project.overdue_count })}
                            </Chip>
                          )}
                          {(project.blocked_count ?? 0) > 0 && (
                            <Chip color="red">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {t("projects:blocked", { count: project.blocked_count })}
                            </Chip>
                          )}
                          {project.overload_warning && (
                            <Chip color="yellow">
                              <Zap className="h-2.5 w-2.5" />
                              {t("projects:overloaded")}
                            </Chip>
                          )}
                        </div>
                      )}

                      {/* Row 5: Meta — team, deadline */}
                      <div className="flex items-center gap-3 text-[11px] text-gray-600">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {t("projects:members", { count: project.team_count ?? 0 })}
                        </span>
                        {project.next_deadline && (
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            {formatNextDeadline(project.next_deadline, i18n.resolvedLanguage ?? "en", t)}
                          </span>
                        )}
                        {project.risk_level && (
                          <span className="ms-auto text-gray-600">{t("projects:risk.suffix", { level: t(`projects:risk.${project.risk_level}`) })}</span>
                        )}
                      </div>

                      {/* Row 6: Progress bar */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] text-gray-600">{t("projects:progress")}</span>
                          <span className="text-[10px] font-medium text-white">{project.progress ?? 0}%</span>
                        </div>
                        <div className="h-1 app-input rounded-full overflow-hidden border border-white/5">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${project.progress ?? 0}%` }}
                            transition={{ delay: index * 0.05 + 0.2, duration: 0.7, ease: "easeOut" }}
                            className={`h-full bg-linear-to-r ${cfg.bar} rounded-full`}
                          />
                        </div>
                        {project.risk_reasons && project.risk_reasons.length > 0 && project.risk_reasons[0] !== "No major risk signals" && (
                          <p className="mt-2 text-[10px] text-gray-600 line-clamp-1">
                            {project.risk_reasons[0]}
                          </p>
                        )}
                      </div>
                    </Link>

                    {/* Action strip — always visible, outside the link */}
                    <div className="border-t border-white/8 px-4 py-2.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => navigate(`/task/${project.id}`)}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:text-white hover:bg-white/8 transition-colors"
                        >
                          <FolderOpen className="h-3 w-3" />
                          {t("projects:open")}
                        </button>
                        <button
                          onClick={() => navigate(`/project/${project.id}/health`)}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:text-purple-300 hover:bg-purple-500/10 transition-colors"
                        >
                          <Activity className="h-3 w-3" />
                          {t("projects:healthAction")}
                        </button>
                        <button
                          onClick={() => navigate(`/project/${project.id}/report`)}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:text-purple-300 hover:bg-purple-500/10 transition-colors"
                        >
                          <FileText className="h-3 w-3" />
                          {t("projects:report")}
                        </button>
                      </div>

                      <button
                        onClick={() => setConfirmId(project.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 text-gray-600 hover:border-red-500/40 hover:bg-red-900/20 hover:text-red-400 transition-colors"
                        aria-label={t("projects:delete.ariaLabel", { name: project.name })}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}

      <AnimatePresence>
        {confirmProject && (
          <ConfirmDeleteModal
            projectName={confirmProject.name}
            onConfirm={handleDelete}
            onCancel={() => setConfirmId(null)}
            deleting={deletingId !== null}
            t={t}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
