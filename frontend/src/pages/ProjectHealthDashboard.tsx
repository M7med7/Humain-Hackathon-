import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, AlertTriangle, ShieldCheck, Clock, Users,
  Zap, TrendingUp, Activity, Sparkles, Loader2,
  CheckCircle2, AlertCircle, Info, ChevronDown, ChevronUp,
  Calendar, Target
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  api,
  type ProjectHealthReport,
  type HealthWorkloadMember,
  type HealthAttentionItem,
  type HealthBurndownPoint,
} from "../lib/api";

// ── Colour helpers ─────────────────────────────────────────────────────────────

function healthColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
}

function healthBorder(score: number): string {
  if (score >= 80) return "border-green-500/30 bg-green-900/10";
  if (score >= 60) return "border-yellow-500/30 bg-yellow-900/10";
  if (score >= 40) return "border-orange-500/30 bg-orange-900/10";
  return "border-red-500/30 bg-red-900/10";
}

function riskColor(level: string): string {
  if (level === "Critical") return "text-red-400 bg-red-900/20 border-red-500/40";
  if (level === "High") return "text-orange-400 bg-orange-900/20 border-orange-500/40";
  if (level === "Medium") return "text-yellow-400 bg-yellow-900/20 border-yellow-500/40";
  return "text-green-400 bg-green-900/20 border-green-500/40";
}

function timelineColor(label: string): string {
  if (label === "Delayed") return "text-red-400 bg-red-900/10 border-red-500/30";
  if (label === "At Risk") return "text-yellow-400 bg-yellow-900/10 border-yellow-500/30";
  return "text-green-400 bg-green-900/10 border-green-500/30";
}

function priorityColor(p: string): string {
  if (p === "High") return "text-red-400 bg-red-500/10 border-red-500/20";
  if (p === "Low") return "text-green-400 bg-green-500/10 border-green-500/20";
  return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
}

function severityIcon(s: HealthAttentionItem["severity"]) {
  if (s === "high") return <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />;
  if (s === "medium") return <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0" />;
  return <Info className="h-4 w-4 text-blue-400 shrink-0" />;
}

function activityIcon(type: string): string {
  if (type.includes("complete") || type === "status_changed") return "✓";
  if (type.includes("comment")) return "💬";
  if (type.includes("assign")) return "👤";
  if (type.includes("import")) return "↓";
  if (type.includes("github")) return "⑂";
  return "·";
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Reusable card shell ────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 ${className}`}>
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-medium">{children}</p>;
}

// ── Burndown mini-chart (pure SVG, no library) ─────────────────────────────────

function BurndownChart({ data }: { data: HealthBurndownPoint[] }) {
  if (!data.length) return null;

  const W = 520;
  const H = 120;
  const PAD = { top: 12, right: 20, bottom: 28, left: 32 };

  const maxCumulative = Math.max(...data.map((d) => d.cumulative), 1);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / (data.length - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / maxCumulative) * innerH;

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d.cumulative)}`)
    .join(" ");

  const areaPath = [
    ...data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d.cumulative)}`),
    `L ${x(data.length - 1)} ${PAD.top + innerH}`,
    `L ${PAD.left} ${PAD.top + innerH}`,
    "Z",
  ].join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {/* Grid lines */}
      {[0, 0.5, 1].map((frac) => (
        <line
          key={frac}
          x1={PAD.left} y1={PAD.top + innerH * (1 - frac)}
          x2={PAD.left + innerW} y2={PAD.top + innerH * (1 - frac)}
          stroke="rgba(255,255,255,0.05)" strokeWidth="1"
        />
      ))}
      {/* Area fill */}
      <path d={areaPath} fill="url(#burnGrad)" opacity="0.35" />
      {/* Line */}
      <path d={linePath} fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Dots */}
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.cumulative)} r="3" fill="#a855f7" />
      ))}
      {/* X labels */}
      {data.map((d, i) => (
        <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fill="rgba(156,163,175,0.7)" fontSize="9">
          {d.label}
        </text>
      ))}
      {/* Y label (max) */}
      <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" fill="rgba(156,163,175,0.7)" fontSize="9">
        {maxCumulative}
      </text>
      <defs>
        <linearGradient id="burnGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Workload bar ───────────────────────────────────────────────────────────────

function WorkloadRow({ member, maxDays }: { member: HealthWorkloadMember; maxDays: number }) {
  const pct = maxDays > 0 ? Math.min(100, (member.estimated_days / maxDays) * 100) : 0;
  const overloaded = member.estimated_days > 10;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0">
        <p className="text-xs font-medium text-white truncate">{member.name}</p>
        <p className="text-[10px] text-gray-500">{member.open_tasks} task{member.open_tasks !== 1 ? "s" : ""}</p>
      </div>
      <div className="flex-1 h-5 rounded-full bg-white/5 overflow-hidden relative">
        <div
          className={`h-full rounded-full transition-all duration-700 ${overloaded ? "bg-red-500/70" : "bg-purple-500/70"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-16 shrink-0 text-right">
        <span className={`text-xs font-medium ${overloaded ? "text-red-400" : "text-gray-400"}`}>
          {member.estimated_days}d
        </span>
        {member.overdue_count > 0 && (
          <span className="ml-1.5 text-[10px] text-red-400">{member.overdue_count} late</span>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function ProjectHealthDashboard() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<ProjectHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [expandedOverdue, setExpandedOverdue] = useState(false);
  const [expandedBlocked, setExpandedBlocked] = useState(false);
  const [expandedActivity, setExpandedActivity] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    api.health.get(projectId)
      .then(setReport)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const generateSummary = useCallback(async () => {
    if (!report || !projectId) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const { summary } = await api.health.summary(projectId, report);
      setSummaryText(summary);
    } catch (err: unknown) {
      setSummaryError(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setSummaryLoading(false);
    }
  }, [report, projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Loading health data…</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <button onClick={() => navigate("/")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-white mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to projects
        </button>
        <div className="rounded-2xl border border-red-500/30 bg-red-900/10 p-6 text-red-400 text-sm">
          {error ?? "Failed to load health data."}
        </div>
      </div>
    );
  }

  const { project, health_score, risk_level, risk_reasons, progress, stats,
          overdue_tasks, blocked_tasks, upcoming_deadlines, workload,
          timeline_confidence, recent_activity, burndown, attention_items } = report;

  const maxWorkloadDays = Math.max(...workload.map((m) => m.estimated_days), 1);

  return (
    <div className="px-4 py-6 md:px-6 md:py-8 max-w-6xl mx-auto space-y-4 md:space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-white mb-3 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Projects
          </button>
          <h1 className="text-2xl font-bold text-white">{project.name}</h1>
          <p className="text-sm text-gray-500 mt-1">Health Dashboard</p>
        </div>
        <button
          onClick={() => navigate(`/task/${project.id}`)}
          className="shrink-0 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2.5 text-sm text-gray-300 hover:text-white transition-colors"
        >
          View tasks
        </button>
      </div>

      {/* Row 1: Score + Progress + Tasks + Risk */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Health Score */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
          <Card className={healthBorder(health_score)}>
            <CardLabel>Health Score</CardLabel>
            <div className="flex items-end gap-2">
              <span className={`text-5xl font-bold tabular-nums leading-none ${healthColor(health_score)}`}>
                {health_score}
              </span>
              <span className="text-gray-500 text-sm mb-1">/100</span>
            </div>
            <p className="text-xs text-gray-500 mt-2 leading-relaxed line-clamp-2">
              {risk_reasons.slice(0, 2).join(" · ")}
            </p>
          </Card>
        </motion.div>

        {/* Progress */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card>
            <CardLabel>Progress</CardLabel>
            <div className="flex items-end gap-2 mb-3">
              <span className="text-5xl font-bold tabular-nums leading-none text-white">{progress}</span>
              <span className="text-gray-500 text-sm mb-1">%</span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ delay: 0.4, duration: 0.8, ease: "easeOut" }}
                className="h-full bg-purple-500 rounded-full"
              />
            </div>
          </Card>
        </motion.div>

        {/* Tasks */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardLabel>Tasks</CardLabel>
            <div className="flex items-end gap-1.5 mb-3">
              <span className="text-5xl font-bold tabular-nums leading-none text-white">{stats.done}</span>
              <span className="text-gray-500 text-2xl mb-0.5">/{stats.total}</span>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
              <div className="rounded-lg bg-white/5 py-1">
                <p className="text-purple-400 font-semibold">{stats.in_progress}</p>
                <p className="text-gray-600">active</p>
              </div>
              <div className="rounded-lg bg-red-900/20 py-1">
                <p className="text-red-400 font-semibold">{stats.overdue}</p>
                <p className="text-gray-600">overdue</p>
              </div>
              <div className="rounded-lg bg-orange-900/15 py-1">
                <p className="text-orange-400 font-semibold">{stats.blocked}</p>
                <p className="text-gray-600">blocked</p>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Risk */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card>
            <CardLabel>Risk Level</CardLabel>
            <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 mb-3 ${riskColor(risk_level)}`}>
              <ShieldCheck className="h-4 w-4" />
              <span className="text-sm font-semibold">{risk_level}</span>
            </div>
            <ul className="space-y-1">
              {risk_reasons.slice(0, 3).map((r, i) => (
                <li key={i} className="text-[11px] text-gray-500 flex items-start gap-1">
                  <span className="shrink-0 mt-0.5">·</span>{r}
                </li>
              ))}
            </ul>
          </Card>
        </motion.div>
      </div>

      {/* What Needs Attention */}
      {attention_items.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-yellow-400" />
              <h2 className="text-sm font-semibold text-white">What needs attention</h2>
            </div>
            <div className="space-y-3">
              {attention_items.map((item, i) => (
                <div key={i} className="flex items-start gap-3 group">
                  {severityIcon(item.severity)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white leading-snug">{item.text}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{item.action}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Row 2: Overdue + Blocked + Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Overdue Tasks */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                <CardLabel>Overdue Tasks</CardLabel>
              </div>
              <span className={`text-2xl font-bold tabular-nums ${stats.overdue > 0 ? "text-red-400" : "text-green-400"}`}>
                {stats.overdue}
              </span>
            </div>
            {overdue_tasks.length > 0 ? (
              <>
                <div className="space-y-2">
                  {(expandedOverdue ? overdue_tasks : overdue_tasks.slice(0, 3)).map((t) => (
                    <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-medium ${priorityColor(t.priority)}`}>{t.priority[0]}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white truncate">{t.title}</p>
                        <p className="text-[10px] text-red-400">{t.days_overdue}d overdue</p>
                      </div>
                    </div>
                  ))}
                </div>
                {overdue_tasks.length > 3 && (
                  <button
                    onClick={() => setExpandedOverdue((v) => !v)}
                    className="mt-2 flex items-center gap-1 text-[11px] text-gray-500 hover:text-white transition-colors"
                  >
                    {expandedOverdue ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {expandedOverdue ? "Show less" : `+${overdue_tasks.length - 3} more`}
                  </button>
                )}
              </>
            ) : (
              <p className="text-xs text-green-400 flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> No overdue tasks</p>
            )}
          </Card>
        </motion.div>

        {/* Blocked Tasks */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-orange-400" />
                <CardLabel>Blocked Tasks</CardLabel>
              </div>
              <span className={`text-2xl font-bold tabular-nums ${stats.blocked > 0 ? "text-orange-400" : "text-green-400"}`}>
                {stats.blocked}
              </span>
            </div>
            {blocked_tasks.length > 0 ? (
              <>
                <div className="space-y-2">
                  {(expandedBlocked ? blocked_tasks : blocked_tasks.slice(0, 3)).map((t) => (
                    <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-medium ${priorityColor(t.priority)}`}>{t.priority[0]}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white truncate">{t.title}</p>
                        <p className="text-[10px] text-orange-400">{t.blocking_count} blocker{t.blocking_count !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {blocked_tasks.length > 3 && (
                  <button
                    onClick={() => setExpandedBlocked((v) => !v)}
                    className="mt-2 flex items-center gap-1 text-[11px] text-gray-500 hover:text-white transition-colors"
                  >
                    {expandedBlocked ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {expandedBlocked ? "Show less" : `+${blocked_tasks.length - 3} more`}
                  </button>
                )}
              </>
            ) : (
              <p className="text-xs text-green-400 flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> No blocked tasks</p>
            )}
          </Card>
        </motion.div>

        {/* Timeline Confidence */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Target className="h-4 w-4 text-purple-400" />
              <CardLabel>Timeline Confidence</CardLabel>
            </div>
            <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 mb-4 ${timelineColor(timeline_confidence.label)}`}>
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm font-semibold">{timeline_confidence.label}</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Confidence score</span>
                <span className="text-white font-medium">{timeline_confidence.score}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Work remaining</span>
                <span className="text-white font-medium">{timeline_confidence.remaining_days}d</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Time available</span>
                <span className={`font-medium ${timeline_confidence.remaining_days > timeline_confidence.available_days ? "text-red-400" : "text-white"}`}>
                  {timeline_confidence.available_days}d
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Weeks left</span>
                <span className="text-white font-medium">{timeline_confidence.weeks_remaining}w</span>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Row 3: Workload */}
      {workload.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-4 w-4 text-purple-400" />
              <h2 className="text-sm font-semibold text-white">Workload by team member</h2>
            </div>
            <div className="space-y-3">
              {workload.map((member) => (
                <WorkloadRow key={member.user_id} member={member} maxDays={maxWorkloadDays} />
              ))}
            </div>
            <p className="mt-3 text-[10px] text-gray-600">Bars show estimated open days. Red = overloaded (&gt;10 days).</p>
          </Card>
        </motion.div>
      )}

      {/* Row 4: Upcoming Deadlines + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Upcoming Deadlines */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
          <Card className="h-full">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-4 w-4 text-purple-400" />
              <h2 className="text-sm font-semibold text-white">Upcoming deadlines</h2>
              <span className="ml-auto text-xs text-gray-600">next 14 days</span>
            </div>
            {upcoming_deadlines.length === 0 ? (
              <p className="text-sm text-gray-600">No deadlines in the next 14 days.</p>
            ) : (
              <div className="space-y-2">
                {upcoming_deadlines.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                    <div className={`flex flex-col items-center justify-center w-10 shrink-0 rounded-lg py-1 ${d.days_until <= 2 ? "bg-red-900/30 border border-red-500/20" : "bg-white/5 border border-white/8"}`}>
                      <span className={`text-[10px] font-bold ${d.days_until <= 2 ? "text-red-400" : "text-gray-400"}`}>
                        {d.days_until === 0 ? "today" : `${d.days_until}d`}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{d.title}</p>
                      {d.assigned_name && <p className="text-[10px] text-gray-500">{d.assigned_name}</p>}
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${priorityColor(d.priority)}`}>{d.priority[0]}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </motion.div>

        {/* Recent Activity */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="h-full">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4 text-purple-400" />
              <h2 className="text-sm font-semibold text-white">Recent activity</h2>
            </div>
            {recent_activity.length === 0 ? (
              <p className="text-sm text-gray-600">No recent activity.</p>
            ) : (
              <div className="space-y-0">
                {(expandedActivity ? recent_activity : recent_activity.slice(0, 6)).map((item, i) => (
                  <div key={i} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
                    <span className="shrink-0 w-5 text-center text-base leading-none mt-0.5">{activityIcon(item.activity_type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white line-clamp-1">
                        <span className="text-gray-400">{item.actor_name}</span>{" "}
                        <span className="text-gray-500">{item.summary}</span>
                      </p>
                      <p className="text-[10px] text-gray-600 truncate">{item.task_title}</p>
                    </div>
                    <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(item.created_at)}</span>
                  </div>
                ))}
                {recent_activity.length > 6 && (
                  <button
                    onClick={() => setExpandedActivity((v) => !v)}
                    className="mt-2 flex items-center gap-1 text-[11px] text-gray-500 hover:text-white transition-colors"
                  >
                    {expandedActivity ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {expandedActivity ? "Show less" : `+${recent_activity.length - 6} more`}
                  </button>
                )}
              </div>
            )}
          </Card>
        </motion.div>
      </div>

      {/* Row 5: Progress Trend */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}>
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-white">Progress trend</h2>
            <span className="ml-auto text-xs text-gray-600">tasks completed per week (last 6 weeks)</span>
          </div>
          <BurndownChart data={burndown} />
          <div className="mt-3 flex items-center gap-6 text-xs text-gray-500">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-purple-500 rounded-full" />
              Cumulative completions
            </div>
            <div className="ml-auto">
              Total: <span className="text-white font-medium">{stats.done}</span> of <span className="text-white font-medium">{stats.total}</span> tasks done
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Row 6: AI Summary */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-400" />
              <h2 className="text-sm font-semibold text-white">AI summary</h2>
            </div>
            {!summaryText && (
              <button
                onClick={generateSummary}
                disabled={summaryLoading}
                className="flex items-center gap-2 rounded-xl bg-purple-600/20 border border-purple-500/40 hover:bg-purple-600/30 px-4 py-2 text-xs font-semibold text-purple-300 hover:text-white transition-colors disabled:opacity-50"
              >
                {summaryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {summaryLoading ? "Generating…" : "Generate summary"}
              </button>
            )}
            {summaryText && (
              <button
                onClick={generateSummary}
                disabled={summaryLoading}
                className="text-xs text-gray-500 hover:text-white transition-colors disabled:opacity-40"
              >
                {summaryLoading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Regenerate"}
              </button>
            )}
          </div>

          <AnimatePresence mode="wait">
            {summaryLoading && (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-3 py-4 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                Analyzing project data…
              </motion.div>
            )}
            {summaryText && !summaryLoading && (
              <motion.div key="summary" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                <div className="text-sm text-gray-300 leading-relaxed space-y-3 whitespace-pre-wrap">
                  {summaryText.split(/\n\n+/).map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </motion.div>
            )}
            {!summaryText && !summaryLoading && (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <p className="text-sm text-gray-600">
                  Click "Generate summary" to get an AI-written health briefing based on real project data.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {summaryError && (
            <p className="mt-3 text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> {summaryError}
            </p>
          )}
        </Card>
      </motion.div>

      {/* Footer: Clock icon + last checked */}
      <div className="flex items-center gap-1.5 text-[11px] text-gray-600 justify-end pb-2">
        <Clock className="h-3 w-3" />
        Health data loaded at {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}
