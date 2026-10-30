import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  Wand2,
  XCircle,
  Zap,
} from "lucide-react";
import type {
  ConversationMessage,
  AssignmentRecommendation,
  GeneratedSchedule,
  GeneratedTask,
  QualityIssue,
  QualityReport,
  RefinementResult,
  TaskDiff,
} from "../lib/api";
import { PlanTaskList } from "./PlanTaskList";
import { PlanRefinementPanel } from "./PlanRefinementPanel";
import { PlanDiffModal } from "./PlanDiffModal";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanQualityReviewProps {
  projectName: string;
  schedule: GeneratedSchedule;
  qualityReport: QualityReport;
  totalDays: number;
  memberNames: Map<string, string>;
  conversationMessages: ConversationMessage[];
  pendingRefinement: RefinementResult | null;
  pendingDiff: TaskDiff | null;
  manuallyEditedTaskIds: ReadonlySet<string>;
  assigneeOverrides: ReadonlySet<string>;
  recommendations: Record<string, AssignmentRecommendation>;
  isRefining: boolean;
  isSaving: boolean;
  isImproving: boolean;
  keepManualEdits: boolean;
  onAccept: () => void;
  onImprove: () => void;
  onBack: () => void;
  onSendRefinement: (message: string) => void;
  onApplyRefinement: () => void;
  onCancelRefinement: () => void;
  onTaskEdit: (taskId: string, field: keyof GeneratedTask, value: string | number) => void;
  onAssigneeChange: (taskId: string, userId: string) => void;
  onToggleKeepManualEdits: () => void;
}

// ── Score ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score, level }: { score: number; level: QualityReport['level'] }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;

  const ringColor =
    level === 'excellent' ? '#22c55e' :
    level === 'good'      ? '#a78bfa' :
    level === 'fair'      ? '#f59e0b' :
                            '#ef4444';

  const levelLabel =
    level === 'excellent' ? 'Excellent' :
    level === 'good'      ? 'Good'      :
    level === 'fair'      ? 'Fair'      :
                            'Needs work';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
          <motion.circle
            cx="50" cy="50" r={radius} fill="none"
            stroke={ringColor} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            initial={{ strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${filled} ${circumference - filled}` }}
            transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className="text-3xl font-bold text-white leading-none"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
          >
            {score}
          </motion.span>
          <span className="text-xs text-gray-400 mt-0.5">/100</span>
        </div>
      </div>
      <span className="text-sm font-semibold" style={{ color: ringColor }}>{levelLabel}</span>
    </div>
  );
}

// ── Severity badge ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: QualityIssue['severity'] }) {
  const styles = {
    high:   'bg-red-900/40 border-red-500/40 text-red-300',
    medium: 'bg-amber-900/30 border-amber-500/40 text-amber-300',
    low:    'bg-blue-900/30 border-blue-500/30 text-blue-300',
  }[severity];
  const label = { high: 'High', medium: 'Medium', low: 'Low' }[severity];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-semibold ${styles}`}>
      {label}
    </span>
  );
}

// ── Issue card ────────────────────────────────────────────────────────────────

function IssueCard({ issue, onQuickFix }: { issue: QualityIssue; onQuickFix: (msg: string) => void }) {
  const [open, setOpen] = useState(false);

  const icon = issue.severity === 'high'
    ? <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
    : <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />;

  // Map issue IDs to quick-fix messages
  const QUICK_FIX_MESSAGES: Record<string, string> = {
    'missing-testing':      'Add comprehensive unit and integration testing tasks before deployment',
    'missing-deployment':   'Add a complete deployment and release phase with CI/CD pipeline tasks',
    'missing-planning':     'Add a requirements gathering and planning phase at the beginning',
    'missing-risk':         'Add risk assessment, mitigation, and contingency planning tasks',
    'missing-design':       'Add UI/UX design, wireframe, and user experience review tasks',
    'missing-database':     'Add database schema design, migration, and data model tasks',
    'timeline-overloaded':  'Compress the schedule and parallelize tasks to fit within the timeline',
    'timeline-underplanned':'Add missing phases to fill out the timeline more completely',
    'oversized-tasks':      'Break the largest tasks into smaller sub-tasks of 1–3 days each',
    'workload-overload':    'Rebalance task assignments so no one person carries more than 50% of the work',
    'unassigned-tasks':     'Assign all unassigned tasks to appropriate team members',
    'no-dependencies':      'Add Finish-to-Start dependencies between tasks to define execution order',
    'deploy-skips-testing': 'Add dependencies so deployment only starts after all testing is complete',
    'test-missing-dev-dep': 'Link each testing task to depend on the development tasks it verifies',
    'vague-task-names':     'Rename all vague tasks with specific, outcome-focused names',
  };

  const fixMessage = QUICK_FIX_MESSAGES[issue.id];

  return (
    <div className="rounded-xl border border-white/8 app-surface-soft overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:app-surface-soft transition-colors"
      >
        {icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white leading-snug">{issue.title}</span>
            <SeverityBadge severity={issue.severity} />
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" /> : <ChevronRight className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 space-y-2.5 border-t border-white/5">
              <p className="text-sm text-gray-400 leading-relaxed">{issue.description}</p>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-900/20 border border-purple-500/20">
                <Wand2 className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                <p className="text-sm text-purple-200 leading-relaxed flex-1">{issue.suggestion}</p>
              </div>
              {fixMessage && (
                <button
                  type="button"
                  onClick={() => onQuickFix(fixMessage)}
                  className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-200 transition-colors border border-purple-500/30 rounded-lg px-3 py-1.5 bg-purple-900/20 hover:bg-purple-900/35"
                >
                  <Sparkles className="w-3 h-3" />
                  Fix this with AI
                </button>
              )}
              {issue.affectedTasks && issue.affectedTasks.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {issue.affectedTasks.slice(0, 4).map((name) => (
                    <span key={name} className="text-xs px-2 py-0.5 rounded-md app-surface-soft border border-white/10 text-gray-400">{name}</span>
                  ))}
                  {issue.affectedTasks.length > 4 && (
                    <span className="text-xs px-2 py-0.5 rounded-md app-surface-soft border border-white/10 text-gray-500">+{issue.affectedTasks.length - 4} more</span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Plan stats ────────────────────────────────────────────────────────────────

function PlanStats({ schedule }: { schedule: GeneratedSchedule }) {
  const totalEffort = schedule.tasks.reduce((s, t) => s + (t.estimated_days || 0), 0);
  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        { label: 'Tasks',        value: schedule.tasks.length },
        { label: 'Person-days',  value: totalEffort },
        { label: 'Dependencies', value: schedule.dependencies.length },
      ].map(({ label, value }) => (
        <div key={label} className="rounded-xl app-surface-soft border border-white/8 px-4 py-3 text-center">
          <div className="text-2xl font-bold text-white">{value}</div>
          <div className="text-xs text-gray-500 mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="border-t border-white/6" />;
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlanQualityReview({
  projectName,
  schedule,
  qualityReport,
  totalDays,
  memberNames,
  conversationMessages,
  pendingRefinement,
  pendingDiff,
  manuallyEditedTaskIds,
  assigneeOverrides,
  recommendations,
  isRefining,
  isSaving,
  isImproving,
  keepManualEdits,
  onAccept,
  onImprove,
  onBack,
  onSendRefinement,
  onApplyRefinement,
  onCancelRefinement,
  onTaskEdit,
  onAssigneeChange,
  onToggleKeepManualEdits,
}: PlanQualityReviewProps) {
  const { score, level, issues, passedChecks } = qualityReport;
  const [showPassed, setShowPassed] = useState(false);

  const highCount   = issues.filter((i) => i.severity === 'high').length;
  const mediumCount = issues.filter((i) => i.severity === 'medium').length;
  const lowCount    = issues.filter((i) => i.severity === 'low').length;

  const durationLabel = totalDays >= 365
    ? `${Math.round(totalDays / 365)}yr`
    : totalDays >= 30
    ? `${Math.round(totalDays / 30)}mo`
    : `${Math.round(totalDays / 7)}wk`;

  const headerMsg =
    score >= 85 ? "Your plan looks great — it's ready to launch." :
    score >= 70 ? "Solid plan. A few things could make it stronger." :
    score >= 50 ? "This plan needs some improvements before starting." :
                  "Several issues found. We recommend improving it first.";

  const busy = isRefining || isSaving || isImproving;

  return (
    <>
      {/* Diff preview modal (portal-style, rendered at top of tree) */}
      <AnimatePresence>
        {pendingDiff && pendingRefinement && (
          <PlanDiffModal
            diff={pendingDiff}
            refinementSummary={pendingRefinement.refinementSummary}
            manuallyEditedTaskIds={manuallyEditedTaskIds}
            keepManualEdits={keepManualEdits}
            onToggleKeepManualEdits={onToggleKeepManualEdits}
            onApply={onApplyRefinement}
            onCancel={onCancelRefinement}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.3 }}
        className="space-y-6"
      >
        {/* ── Score + summary ─────────────────────────────────────────── */}
        <div className="flex items-start gap-5">
          <ScoreRing score={score} level={level} />
          <div className="flex-1 min-w-0 pt-1">
            <h3 className="text-xl font-bold text-white mb-1">Plan Review</h3>
            <div className="flex items-center gap-2">
              <p className="text-base font-semibold text-purple-200 truncate">{projectName}</p>
              <span className="shrink-0 text-xs text-gray-600 border border-white/10 rounded px-1.5 py-0.5">{durationLabel}</span>
            </div>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">{headerMsg}</p>
            {issues.length > 0 && (
              <div className="mt-3 flex items-center gap-3 text-xs">
                {highCount   > 0 && <span className="text-red-400">{highCount} high</span>}
                {mediumCount > 0 && <span className="text-amber-400">{mediumCount} medium</span>}
                {lowCount    > 0 && <span className="text-blue-400">{lowCount} low</span>}
                <span className="text-gray-600">·</span>
                <span className="text-gray-500">{issues.length} issue{issues.length !== 1 ? 's' : ''} detected</span>
              </div>
            )}
          </div>
        </div>

        <PlanStats schedule={schedule} />

        <Divider />

        {/* ── Task list with inline editing ───────────────────────────── */}
        <PlanTaskList
          tasks={schedule.tasks}
          memberNames={memberNames}
          manuallyEditedTaskIds={manuallyEditedTaskIds}
          assigneeOverrides={assigneeOverrides}
          recommendations={recommendations}
          onTaskEdit={onTaskEdit}
          onAssigneeChange={onAssigneeChange}
        />

        <Divider />

        {/* ── Quality issues ──────────────────────────────────────────── */}
        {issues.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Detected issues
            </p>
            <div className="space-y-2">
              {[...issues]
                .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]))
                .map((issue) => (
                  <IssueCard key={issue.id} issue={issue} onQuickFix={onSendRefinement} />
                ))}
            </div>
          </div>
        )}

        {/* ── Passed checks ───────────────────────────────────────────── */}
        {passedChecks.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowPassed((v) => !v)}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              {passedChecks.length} check{passedChecks.length !== 1 ? 's' : ''} passed
              {showPassed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            <AnimatePresence>
              {showPassed && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden mt-2 space-y-1 pl-6"
                >
                  {passedChecks.map((check) => (
                    <li key={check} className="text-sm text-green-400 flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      {check}
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )}

        <Divider />

        {/* ── Quick refinement presets ─────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-purple-400" />
            Quick actions
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Make it more realistic", msg: "Make the task estimates more realistic — increase time for complex tasks, add buffer time, and ensure no task is underestimated for its scope." },
              { label: "Make it faster", msg: "Optimize the schedule to be faster — parallelize independent tasks, trim unnecessary steps, and focus only on what's essential to ship." },
              { label: "More testing tasks", msg: "Add comprehensive unit, integration, and end-to-end testing tasks throughout the plan." },
              { label: "Add deployment phase", msg: "Add a complete deployment and release phase including CI/CD pipeline setup, staging environment, and production rollout." },
              { label: "Balance workload", msg: "Rebalance task assignments so work is distributed evenly across all team members." },
            ].map(({ label, msg }) => (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => onSendRefinement(msg)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
                  busy
                    ? "border-white/5 text-white/20 cursor-not-allowed"
                    : "border-white/12 app-surface-soft text-gray-400 hover:border-purple-500/40 hover:bg-purple-900/20 hover:text-purple-200"
                }`}
              >
                {isRefining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {label}
              </button>
            ))}
          </div>
        </div>

        <Divider />

        {/* ── AI Refinement chat ──────────────────────────────────────── */}
        <PlanRefinementPanel
          messages={conversationMessages}
          isRefining={isRefining}
          onSend={onSendRefinement}
        />

        <Divider />

        {/* ── Primary actions ─────────────────────────────────────────── */}
        <div className="space-y-3 pt-2">
          {/* Accept */}
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className={`w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl text-base font-semibold transition-all duration-200 ${
              busy
                ? 'app-surface-soft text-white/30 cursor-not-allowed border border-white/5'
                : 'bg-purple-600 hover:bg-purple-500 text-white border border-purple-400/30 shadow-lg shadow-purple-500/20 hover:-translate-y-0.5 active:translate-y-0'
            }`}
          >
            {isSaving ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Saving project...</>
            ) : (
              <><Zap className="w-5 h-5" /> Accept plan and create project</>
            )}
          </button>

          {/* Improve with quality checker */}
          {issues.length > 0 && (
            <button
              type="button"
              onClick={onImprove}
              disabled={busy}
              className={`w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl text-base font-semibold transition-all duration-200 border ${
                busy
                  ? 'border-white/5 text-white/30 cursor-not-allowed app-surface-soft'
                  : 'border-purple-500/40 text-purple-200 bg-purple-900/20 hover:bg-purple-900/35 hover:border-purple-400/60 hover:-translate-y-0.5 active:translate-y-0'
              }`}
            >
              {isImproving ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> AI is improving the plan...</>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Fix all issues automatically
                  <span className="text-xs text-purple-400 font-normal ml-1">({issues.length})</span>
                </>
              )}
            </button>
          )}

          {/* Back */}
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className={`w-full flex items-center justify-center gap-2 py-3 px-6 rounded-2xl text-sm text-gray-500 hover:text-gray-300 transition-colors ${busy ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to edit form
          </button>
        </div>
      </motion.div>
    </>
  );
}
