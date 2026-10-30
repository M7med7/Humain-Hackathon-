import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, RefreshCw, Copy, Download, Send, Check,
  ChevronDown, ChevronUp, Loader2, AlertTriangle, Clock,
  CheckCircle2, AlertCircle, TrendingUp, TrendingDown,
  Users, Sparkles, Pencil, X, Calendar, Bell
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  api,
  type WeeklyReport,
  type ReportSections,
  type ReportCompletedTask,
  type ReportDelayedTask,
  type ReportBlockedTask,
  type ReportAtRiskTask,
  type ReportWorkloadMember,
} from "../lib/api";

// ── Constants ──────────────────────────────────────────────────────────────────

const SCHEDULE_KEY = (id: string) => `01m_report_schedule_${id}`;
const LAST_GEN_KEY = (id: string) => `01m_report_lastgen_${id}`;

// ── Colour helpers ─────────────────────────────────────────────────────────────

function priorityColor(p: string) {
  if (p === "High") return "text-red-400 bg-red-500/10 border-red-500/20";
  if (p === "Low") return "text-green-400 bg-green-500/10 border-green-500/20";
  return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
}

function statusColor(s: ReportWorkloadMember["status"]) {
  if (s === "Overloaded") return "text-red-400";
  if (s === "Available") return "text-green-400";
  return "text-gray-400";
}

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

// ── Reusable primitives ────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/10 app-surface-soft ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({
  icon, title, count, expanded, onToggle, editMode, onEdit,
}: {
  icon: React.ReactNode; title: string; count?: number; expanded: boolean;
  onToggle: () => void; editMode?: boolean; onEdit?: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-5 py-4 text-left group"
    >
      <span className="text-purple-400">{icon}</span>
      <span className="flex-1 text-sm font-semibold text-white">{title}</span>
      {count !== undefined && (
        <span className="text-xs text-gray-500 mr-2">{count} item{count !== 1 ? "s" : ""}</span>
      )}
      {onEdit && (
        <span
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="mr-2 rounded-lg px-2 py-1 text-[10px] font-medium border border-white/10 text-gray-500 hover:text-white hover:border-white/20 transition-colors"
        >
          {editMode ? "Done" : "Edit"}
        </span>
      )}
      {expanded ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
    </button>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold shrink-0 ${priorityColor(priority)}`}>
      {priority[0]}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-5 pb-4 text-sm text-green-400">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      {text}
    </div>
  );
}

// ── Editable narrative block ───────────────────────────────────────────────────

function EditableText({
  value, onChange, editMode,
}: { value: string; onChange: (v: string) => void; editMode: boolean }) {
  return editMode ? (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={Math.max(3, value.split("\n").length + 1)}
      className="w-full app-surface-soft border border-purple-500/40 rounded-xl px-4 py-3 text-sm text-white leading-relaxed resize-y focus:outline-none focus:border-purple-500/70 transition-colors"
    />
  ) : (
    <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{value}</p>
  );
}

function EditableList({
  items, onChange, editMode,
}: { items: string[]; onChange: (v: string[]) => void; editMode: boolean }) {
  if (!editMode) {
    return (
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
            <span className="shrink-0 text-purple-400 mt-0.5">→</span>
            {item}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="shrink-0 text-purple-400 mt-2.5 text-sm">→</span>
          <input
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            className="flex-1 app-surface-soft border border-purple-500/40 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/70 transition-colors"
          />
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="mt-1.5 text-gray-600 hover:text-red-400 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, ""])}
        className="text-xs text-purple-400 hover:text-purple-300 transition-colors mt-1"
      >
        + Add item
      </button>
    </div>
  );
}

// ── Plain-text export builder ──────────────────────────────────────────────────

function buildPlainText(report: WeeklyReport, sections: ReportSections): string {
  const lines: string[] = [];
  const hr = "─".repeat(60);

  lines.push(`WEEKLY STATUS REPORT — ${report.project.name}`);
  lines.push(`Period: ${report.period}`);
  lines.push(`Generated: ${new Date(report.generated_at).toLocaleString()}`);
  lines.push("");
  lines.push(`Progress: ${report.stats.progress}% | Completed: ${report.stats.completed_this_week} | Overdue: ${report.stats.overdue} | Blocked: ${report.stats.blocked}`);
  lines.push(hr);

  lines.push("\nEXECUTIVE SUMMARY");
  lines.push(sections.executive_summary);
  lines.push("");

  lines.push(hr);
  lines.push("\nCOMPLETED THIS WEEK");
  if (sections.completed_tasks.length === 0) {
    lines.push("No tasks completed this week.");
  } else {
    sections.completed_tasks.forEach((t) => {
      lines.push(`  [${t.priority[0]}] ${t.title}${t.assigned_name ? ` — ${t.assigned_name}` : ""}`);
    });
  }

  lines.push("\nDELAYED / OVERDUE");
  if (sections.delayed_tasks.length === 0) {
    lines.push("No overdue tasks.");
  } else {
    sections.delayed_tasks.forEach((t) => {
      lines.push(`  [${t.priority[0]}] ${t.title} — ${t.days_overdue}d overdue${t.assigned_name ? `, ${t.assigned_name}` : ""}`);
    });
  }

  lines.push("\nBLOCKED");
  if (sections.blocked_tasks.length === 0) {
    lines.push("No blocked tasks.");
  } else {
    sections.blocked_tasks.forEach((t) => {
      lines.push(`  [${t.priority[0]}] ${t.title} — blocked by ${t.blocking_count} task${t.blocking_count !== 1 ? "s" : ""}`);
    });
  }

  lines.push("\nAT RISK");
  if (sections.at_risk_tasks.length === 0) {
    lines.push("No tasks flagged as at risk.");
  } else {
    sections.at_risk_tasks.forEach((r) => {
      lines.push(`  [${r.task.priority[0]}] ${r.task.title} — ${r.reason}`);
    });
  }

  lines.push("\nTEAM WORKLOAD");
  sections.team_workload.forEach((m) => {
    lines.push(`  ${m.name}: ${m.open_tasks} open tasks, ${m.estimated_days}d estimated, ${m.completed_this_week} completed this week${m.status === "Overloaded" ? " ⚠ overloaded" : ""}`);
  });

  const ch = sections.changes_from_last_week;
  lines.push("\nCHANGES FROM LAST WEEK");
  lines.push(`  Completions: ${ch.completed_this_week} this week vs ${ch.completed_last_week} last week (${ch.completion_delta_label})`);
  lines.push(`  New tasks added: ${ch.new_tasks_added}`);
  lines.push(`  Velocity: ${ch.velocity_trend}`);

  lines.push("\nNEXT WEEK PRIORITIES");
  sections.next_week_priorities.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));

  lines.push("\nRECOMMENDATIONS");
  sections.recommendations.forEach((r, i) => lines.push(`  ${i + 1}. ${r}`));

  lines.push(`\n${hr}`);
  lines.push("Generated by 01 Manager");

  return lines.join("\n");
}

// ── Schedule helper ────────────────────────────────────────────────────────────

function getSchedule(projectId: string): { enabled: boolean; dayOfWeek: number } {
  try {
    const raw = localStorage.getItem(SCHEDULE_KEY(projectId));
    return raw ? JSON.parse(raw) : { enabled: false, dayOfWeek: 1 };
  } catch {
    return { enabled: false, dayOfWeek: 1 };
  }
}

function saveSchedule(projectId: string, schedule: { enabled: boolean; dayOfWeek: number }) {
  localStorage.setItem(SCHEDULE_KEY(projectId), JSON.stringify(schedule));
}

function isReportDue(projectId: string, dayOfWeek: number): boolean {
  const lastGen = localStorage.getItem(LAST_GEN_KEY(projectId));
  if (!lastGen) return true;
  const daysSince = (Date.now() - Number(lastGen)) / 86400000;
  if (daysSince < 6) return false;
  return new Date().getDay() === dayOfWeek;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── Main page ──────────────────────────────────────────────────────────────────

export function WeeklyReportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [sections, setSections] = useState<ReportSections | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["summary", "completed", "delayed", "blocked", "priorities", "recommendations"]));
  const [editingSections, setEditingSections] = useState<Set<string>>(new Set());

  const [copied, setCopied] = useState(false);
  const [slackSending, setSlackSending] = useState(false);
  const [slackSent, setSlackSent] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);

  const [schedule, setSchedule] = useState(() => projectId ? getSchedule(projectId) : { enabled: false, dayOfWeek: 1 });
  const [showSchedule, setShowSchedule] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const autoGenTriggered = useRef(false);

  const plainTextRef = useRef<string>("");

  const generate = useCallback(async () => {
    if (!projectId) return;
    setGenerating(true);
    setGenError(null);
    setSlackSent(false);
    setSlackError(null);
    try {
      const result = await api.reports.generate(projectId);
      setReport(result);
      setSections({ ...result.sections });
      localStorage.setItem(LAST_GEN_KEY(projectId), String(Date.now()));
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  }, [projectId]);

  // Check scheduled report on mount. The ref prevents StrictMode's repeated
  // development effect from generating the same report twice.
  useEffect(() => {
    if (!projectId || autoGenTriggered.current) return;
    const savedSchedule = getSchedule(projectId);
    if (savedSchedule.enabled && isReportDue(projectId, savedSchedule.dayOfWeek)) {
      autoGenTriggered.current = true;
      // Scheduled generation intentionally starts from this synchronization effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void generate();
    }
  }, [generate, projectId]);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleEdit = (key: string) => {
    setEditingSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleCopy = () => {
    if (!report || !sections) return;
    const text = buildPlainText(report, sections);
    plainTextRef.current = text;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleDownload = () => {
    if (!report || !sections) return;
    const text = buildPlainText(report, sections);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${report.project.name.replace(/[^a-zA-Z0-9-_]/g, "_")}-weekly-report.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleSendSlack = async () => {
    if (!report || !projectId) return;
    setSlackSending(true);
    setSlackError(null);
    try {
      const current: WeeklyReport = { ...report, sections: sections! };
      await api.reports.sendSlack(projectId, current);
      setSlackSent(true);
    } catch (err: unknown) {
      setSlackError(err instanceof Error ? err.message : "Failed to send to Slack");
    } finally {
      setSlackSending(false);
    }
  };

  const handleScheduleChange = (next: { enabled: boolean; dayOfWeek: number }) => {
    setSchedule(next);
    if (projectId) saveSchedule(projectId, next);
  };

  if (!report && !generating && !genError) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-8">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-purple-500/30 bg-purple-500/10">
            <Sparkles className="h-8 w-8 text-purple-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Weekly Status Report</h1>
          <p className="text-sm text-gray-500 max-w-sm">
            Generate an AI-written weekly report for this project — covering completions, blockers, team load, and next steps.
          </p>
        </div>

        <button
          onClick={generate}
          className="flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition-colors"
        >
          <Sparkles className="h-4 w-4" />
          Generate report
        </button>

        <button
          onClick={() => navigate("/")}
          className="mt-4 flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to projects
        </button>
      </div>
    );
  }

  if (generating) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-purple-500/30 bg-purple-500/10">
          <Loader2 className="h-6 w-6 text-purple-400 animate-spin" />
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">Generating report…</h2>
        <p className="text-sm text-gray-500">Analysing tasks, team workload, and this week's changes</p>
      </div>
    );
  }

  if (genError) {
    return (
      <div className="p-8 max-w-lg mx-auto">
        <button onClick={() => navigate("/")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-white mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="rounded-2xl border border-red-500/30 bg-red-900/10 p-5 text-red-400 text-sm mb-4">{genError}</div>
        <button onClick={generate} className="flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors">
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  if (!report || !sections) return null;

  const changes = sections.changes_from_last_week;

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-white mb-3 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Projects
          </button>
          <h1 className="text-2xl font-bold text-white">{report.project.name}</h1>
          <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-500">
            <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{report.period}</span>
            <span>·</span>
            <span>Generated {timeAgo(report.generated_at)}</span>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 app-surface-soft hover:app-surface-soft px-3 py-2 text-xs font-medium text-gray-300 hover:text-white transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Regenerate
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 app-surface-soft hover:app-surface-soft px-3 py-2 text-xs font-medium text-gray-300 hover:text-white transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 app-surface-soft hover:app-surface-soft px-3 py-2 text-xs font-medium text-gray-300 hover:text-white transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Download
          </button>
          <button
            onClick={() => setShowEmailModal(true)}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 app-surface-soft hover:app-surface-soft px-3 py-2 text-xs font-medium text-gray-300 hover:text-white transition-colors"
          >
            <Send className="h-3.5 w-3.5" /> Email
          </button>
          <button
            onClick={handleSendSlack}
            disabled={slackSending || slackSent}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${slackSent ? "border-green-500/40 bg-green-900/20 text-green-400" : "border-purple-500/40 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 hover:text-white"}`}
          >
            {slackSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : slackSent ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            {slackSent ? "Sent!" : "Send to Slack"}
          </button>
          <button
            onClick={() => setShowSchedule((v) => !v)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${schedule.enabled ? "border-purple-500/40 bg-purple-600/15 text-purple-300" : "border-white/10 app-surface-soft text-gray-500 hover:text-white hover:app-surface-soft"}`}
          >
            <Bell className="h-3.5 w-3.5" />
            {schedule.enabled ? `Weekly (${DAY_NAMES[schedule.dayOfWeek]})` : "Schedule"}
          </button>
        </div>
      </div>

      {slackError && (
        <div className="rounded-xl border border-red-500/30 bg-red-900/10 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />{slackError}
        </div>
      )}

      {/* Schedule panel */}
      <AnimatePresence>
        {showSchedule && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
            <Card className="px-5 py-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-purple-400" />
                  <span className="text-sm font-semibold text-white">Weekly schedule</span>
                </div>
                <button onClick={() => setShowSchedule(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={schedule.enabled}
                    onChange={(e) => handleScheduleChange({ ...schedule, enabled: e.target.checked })}
                    className="accent-purple-500 w-4 h-4"
                  />
                  Auto-generate every week on
                </label>
                <select
                  value={schedule.dayOfWeek}
                  onChange={(e) => handleScheduleChange({ ...schedule, dayOfWeek: Number(e.target.value) })}
                  disabled={!schedule.enabled}
                  className="rounded-lg border border-white/10 app-surface-soft px-3 py-1.5 text-sm text-white focus:outline-none focus:border-purple-500/60 disabled:opacity-40"
                >
                  {DAY_NAMES.map((d, i) => <option key={i} value={i} className="bg-black">{d}</option>)}
                </select>
              </div>
              <p className="mt-3 text-xs text-gray-600">
                When enabled, the report auto-generates when you open this page on the scheduled day (after 7 days since the last report).
              </p>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Progress", value: `${report.stats.progress}%`, sub: `${report.stats.done}/${report.stats.total} tasks`, color: "text-purple-400" },
          { label: "Completed", value: report.stats.completed_this_week, sub: changes.completion_delta_label, color: changes.velocity_trend === "improving" ? "text-green-400" : "text-yellow-400", icon: changes.velocity_trend === "improving" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" /> },
          { label: "Overdue", value: report.stats.overdue, sub: report.stats.overdue > 0 ? "needs action" : "none", color: report.stats.overdue > 0 ? "text-red-400" : "text-green-400" },
          { label: "Blocked", value: report.stats.blocked, sub: report.stats.blocked > 0 ? "resolve first" : "none", color: report.stats.blocked > 0 ? "text-orange-400" : "text-green-400" },
        ].map((stat) => (
          <Card key={stat.label} className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">{stat.label}</p>
            <div className={`text-2xl font-bold tabular-nums ${stat.color}`}>{stat.value}</div>
            <p className="text-[11px] text-gray-600 mt-1 flex items-center gap-1">
              {stat.icon}{stat.sub}
            </p>
          </Card>
        ))}
      </div>

      {/* 1. Executive Summary */}
      <Card>
        <SectionHeader
          icon={<Sparkles className="h-4 w-4" />}
          title="Executive Summary"
          expanded={expandedSections.has("summary")}
          onToggle={() => toggleSection("summary")}
          editMode={editingSections.has("summary")}
          onEdit={() => toggleEdit("summary")}
        />
        <AnimatePresence>
          {expandedSections.has("summary") && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              <div className="px-5 pb-5">
                <EditableText
                  value={sections.executive_summary}
                  onChange={(v) => setSections((s) => s ? { ...s, executive_summary: v } : s)}
                  editMode={editingSections.has("summary")}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* 2. Completed this week */}
      <Card>
        <SectionHeader
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="Completed this week"
          count={sections.completed_tasks.length}
          expanded={expandedSections.has("completed")}
          onToggle={() => toggleSection("completed")}
        />
        <AnimatePresence>
          {expandedSections.has("completed") && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              {sections.completed_tasks.length === 0 ? (
                <EmptyState text="No tasks completed this week yet." />
              ) : (
                <div className="px-5 pb-4 space-y-2">
                  {sections.completed_tasks.map((t: ReportCompletedTask) => (
                    <div key={t.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                      <Check className="h-4 w-4 text-green-400 shrink-0" />
                      <PriorityBadge priority={t.priority} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white">{t.title}</p>
                        <p className="text-[11px] text-gray-600">
                          {t.assigned_name && `${t.assigned_name} · `}
                          {t.estimated_days}d estimate · {new Date(t.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* 3. Delayed / Overdue */}
      <Card>
        <SectionHeader
          icon={<Clock className="h-4 w-4" />}
          title="Delayed / Overdue"
          count={sections.delayed_tasks.length}
          expanded={expandedSections.has("delayed")}
          onToggle={() => toggleSection("delayed")}
        />
        <AnimatePresence>
          {expandedSections.has("delayed") && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              {sections.delayed_tasks.length === 0 ? (
                <EmptyState text="No overdue tasks. On track." />
              ) : (
                <div className="px-5 pb-4 space-y-2">
                  {sections.delayed_tasks.map((t: ReportDelayedTask) => (
                    <div key={t.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                      <PriorityBadge priority={t.priority} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white">{t.title}</p>
                        <p className="text-[11px] text-gray-600">
                          {t.assigned_name && `${t.assigned_name} · `}
                          <span className="text-red-400">{t.days_overdue}d overdue</span>
                          {t.end_date && ` · was due ${new Date(t.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                        </p>
                      </div>
                      <span className="text-[10px] text-gray-600 shrink-0">{t.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* 4. Blocked */}
      <Card>
        <SectionHeader
          icon={<AlertCircle className="h-4 w-4" />}
          title="Blocked tasks"
          count={sections.blocked_tasks.length}
          expanded={expandedSections.has("blocked")}
          onToggle={() => toggleSection("blocked")}
        />
        <AnimatePresence>
          {expandedSections.has("blocked") && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              {sections.blocked_tasks.length === 0 ? (
                <EmptyState text="No blocked tasks." />
              ) : (
                <div className="px-5 pb-4 space-y-2">
                  {sections.blocked_tasks.map((t: ReportBlockedTask) => (
                    <div key={t.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                      <AlertCircle className="h-4 w-4 text-orange-400 shrink-0" />
                      <PriorityBadge priority={t.priority} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white">{t.title}</p>
                        <p className="text-[11px] text-gray-600">
                          {t.assigned_name && `${t.assigned_name} · `}
                          blocked by {t.blocking_count} task{t.blocking_count !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* 5. At Risk */}
      <Card>
        <SectionHeader
          icon={<AlertTriangle className="h-4 w-4" />}
          title="At-risk tasks"
          count={sections.at_risk_tasks.length}
          expanded={expandedSections.has("atrisk")}
          onToggle={() => toggleSection("atrisk")}
        />
        <AnimatePresence>
          {expandedSections.has("atrisk") && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              {sections.at_risk_tasks.length === 0 ? (
                <EmptyState text="No tasks flagged as at-risk." />
              ) : (
                <div className="px-5 pb-4 space-y-2">
                  {sections.at_risk_tasks.map((r: ReportAtRiskTask, i: number) => (
                    <div key={i} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
                      <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
                      <PriorityBadge priority={r.task.priority} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white">{r.task.title}</p>
                        <p className="text-[11px] text-yellow-600">{r.reason}</p>
                        {r.task.assigned_name && <p className="text-[11px] text-gray-600">{r.task.assigned_name}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* 6. Team Workload */}
      <Card>
        <SectionHeader
          icon={<Users className="h-4 w-4" />}
          title="Team workload"
          count={sections.team_workload.length}
          expanded={expandedSections.has("workload")}
          onToggle={() => toggleSection("workload")}
        />
        <AnimatePresence>
          {expandedSections.has("workload") && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              {sections.team_workload.length === 0 ? (
                <EmptyState text="No team members assigned." />
              ) : (
                <div className="px-5 pb-4">
                  <div className="grid grid-cols-4 text-[10px] uppercase tracking-widest text-gray-600 mb-2 px-1">
                    <span>Member</span><span className="text-center">Open</span><span className="text-center">Done ↑wk</span><span className="text-center">Est.</span>
                  </div>
                  {sections.team_workload.map((m: ReportWorkloadMember) => (
                    <div key={m.user_id} className="grid grid-cols-4 items-center py-2.5 border-b border-white/5 last:border-0">
                      <div>
                        <p className="text-sm text-white font-medium">{m.name}</p>
                        <p className={`text-[10px] ${statusColor(m.status)}`}>{m.status}</p>
                      </div>
                      <p className={`text-sm text-center font-medium tabular-nums ${m.overdue_count > 0 ? "text-red-400" : "text-gray-300"}`}>
                        {m.open_tasks}{m.overdue_count > 0 && <span className="text-red-400 text-[10px] ml-1">({m.overdue_count} late)</span>}
                      </p>
                      <p className="text-sm text-center font-medium tabular-nums text-green-400">{m.completed_this_week}</p>
                      <p className={`text-sm text-center font-medium tabular-nums ${m.estimated_days > 10 ? "text-red-400" : "text-gray-300"}`}>{m.estimated_days}d</p>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* 7. Changes from last week */}
      <Card>
        <SectionHeader
          icon={<TrendingUp className="h-4 w-4" />}
          title="Changes from last week"
          expanded={expandedSections.has("changes")}
          onToggle={() => toggleSection("changes")}
        />
        <AnimatePresence>
          {expandedSections.has("changes") && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              <div className="px-5 pb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "This week", value: changes.completed_this_week, sub: "completed", color: "text-white" },
                  { label: "Last week", value: changes.completed_last_week, sub: "completed", color: "text-gray-400" },
                  { label: "Delta", value: changes.completion_delta >= 0 ? `+${changes.completion_delta}` : String(changes.completion_delta), sub: changes.velocity_trend, color: changes.velocity_trend === "improving" ? "text-green-400" : "text-red-400" },
                  { label: "New tasks", value: `+${changes.new_tasks_added}`, sub: "added this week", color: "text-purple-400" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-white/8 app-surface-soft px-3 py-2.5">
                    <p className="text-[10px] text-gray-600 mb-1">{s.label}</p>
                    <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-gray-600">{s.sub}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* 8. Next week priorities */}
      <Card>
        <SectionHeader
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="Next week priorities"
          count={sections.next_week_priorities.length}
          expanded={expandedSections.has("priorities")}
          onToggle={() => toggleSection("priorities")}
          editMode={editingSections.has("priorities")}
          onEdit={() => toggleEdit("priorities")}
        />
        <AnimatePresence>
          {expandedSections.has("priorities") && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              <div className="px-5 pb-5">
                <EditableList
                  items={sections.next_week_priorities}
                  onChange={(v) => setSections((s) => s ? { ...s, next_week_priorities: v } : s)}
                  editMode={editingSections.has("priorities")}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* 9. AI Recommendations */}
      <Card>
        <SectionHeader
          icon={<Sparkles className="h-4 w-4" />}
          title="AI recommendations"
          count={sections.recommendations.length}
          expanded={expandedSections.has("recommendations")}
          onToggle={() => toggleSection("recommendations")}
          editMode={editingSections.has("recommendations")}
          onEdit={() => toggleEdit("recommendations")}
        />
        <AnimatePresence>
          {expandedSections.has("recommendations") && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              <div className="px-5 pb-5">
                <EditableList
                  items={sections.recommendations}
                  onChange={(v) => setSections((s) => s ? { ...s, recommendations: v } : s)}
                  editMode={editingSections.has("recommendations")}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-2 pb-6 flex-wrap gap-3">
        <p className="text-xs text-gray-600 flex items-center gap-1.5">
          <Pencil className="h-3 w-3" /> Click "Edit" on any section to modify before sharing
        </p>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors shadow-lg shadow-purple-500/20">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy report"}
          </button>
        </div>
      </div>

      {/* Email modal */}
      <AnimatePresence>
        {showEmailModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center app-surface-elevated backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-2xl rounded-2xl border border-white/10 app-surface-elevated p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-white">Email report</h2>
                <button onClick={() => setShowEmailModal(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="text-sm text-gray-500 mb-4">Copy the formatted text below and paste it into your email client.</p>
              <textarea
                readOnly
                value={report && sections ? buildPlainText(report, sections) : ""}
                rows={16}
                className="w-full app-surface-soft border border-white/10 rounded-xl px-4 py-3 text-xs text-gray-300 font-mono resize-none focus:outline-none"
              />
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setShowEmailModal(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Close</button>
                <button
                  onClick={() => {
                    if (report && sections) {
                      navigator.clipboard.writeText(buildPlainText(report, sections));
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }
                  }}
                  className="flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2 text-sm font-semibold text-white transition-colors"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied!" : "Copy text"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
