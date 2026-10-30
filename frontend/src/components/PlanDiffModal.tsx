import { motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  Minus,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import type { TaskDiff } from "../lib/api";

interface PlanDiffModalProps {
  diff: TaskDiff;
  refinementSummary: string;
  manuallyEditedTaskIds: ReadonlySet<string>;
  keepManualEdits: boolean;
  onToggleKeepManualEdits: () => void;
  onApply: () => void;
  onCancel: () => void;
}

function DiffRow({
  kind,
  title,
  detail,
}: {
  kind: 'added' | 'removed' | 'modified';
  title: string;
  detail?: string;
}) {
  const styles = {
    added:    { bg: 'bg-green-900/20 border-green-500/25', icon: <Plus className="w-3.5 h-3.5 text-green-400 shrink-0" />, text: 'text-green-200' },
    removed:  { bg: 'bg-red-900/20 border-red-500/25',   icon: <Minus className="w-3.5 h-3.5 text-red-400 shrink-0" />,  text: 'text-red-200'   },
    modified: { bg: 'bg-amber-900/15 border-amber-500/25', icon: <RefreshCw className="w-3.5 h-3.5 text-amber-400 shrink-0" />, text: 'text-amber-200' },
  }[kind];

  return (
    <div className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border ${styles.bg}`}>
      <span className="mt-0.5">{styles.icon}</span>
      <div className="min-w-0 flex-1">
        <span className={`text-sm font-medium ${styles.text}`}>{title}</span>
        {detail && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{detail}</p>}
      </div>
    </div>
  );
}

export function PlanDiffModal({
  diff,
  refinementSummary,
  manuallyEditedTaskIds,
  keepManualEdits,
  onToggleKeepManualEdits,
  onApply,
  onCancel,
}: PlanDiffModalProps) {
  const { added, removed, modified } = diff;
  const totalChanges = added.length + removed.length + modified.length;

  // Tasks from modified/removed that the user has manually edited
  const conflictingIds = new Set([
    ...removed.filter((t) => manuallyEditedTaskIds.has(t.id)).map((t) => t.id),
    ...modified.filter((m) => manuallyEditedTaskIds.has(m.before.id)).map((m) => m.before.id),
  ]);
  const hasConflicts = conflictingIds.size > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-lg bg-[#0e0e14] border border-white/12 rounded-3xl overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-white/8">
          <div>
            <h3 className="text-lg font-bold text-white">Preview changes</h3>
            <p className="text-sm text-gray-400 mt-0.5 leading-relaxed">{refinementSummary}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/25 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 px-6 py-3 border-b border-white/5">
          {added.length > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <Plus className="w-3.5 h-3.5 text-green-400" />
              <span className="text-green-300 font-medium">{added.length} added</span>
            </div>
          )}
          {modified.length > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-amber-300 font-medium">{modified.length} changed</span>
            </div>
          )}
          {removed.length > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <Minus className="w-3.5 h-3.5 text-red-400" />
              <span className="text-red-300 font-medium">{removed.length} removed</span>
            </div>
          )}
          {totalChanges === 0 && (
            <span className="text-sm text-gray-500">No task changes detected</span>
          )}
        </div>

        {/* Change list */}
        <div className="px-6 py-4 space-y-1.5 max-h-72 overflow-y-auto">
          {added.map((task) => (
            <DiffRow
              key={task.id}
              kind="added"
              title={task.title}
              detail={`${task.estimated_days}d · ${task.priority ?? 'Medium'}`}
            />
          ))}
          {modified.map(({ before, after }) => {
            const details: string[] = [];
            if (before.title !== after.title) details.push(`renamed to "${after.title}"`);
            if (before.estimated_days !== after.estimated_days)
              details.push(`${before.estimated_days}d → ${after.estimated_days}d`);
            if (before.assigned_to !== after.assigned_to)
              details.push(`reassigned`);
            return (
              <DiffRow
                key={before.id}
                kind="modified"
                title={before.title}
                detail={details.length > 0 ? details.join(' · ') : 'updated'}
              />
            );
          })}
          {removed.map((task) => (
            <DiffRow
              key={task.id}
              kind="removed"
              title={task.title}
              detail={`${task.estimated_days}d`}
            />
          ))}
        </div>

        {/* Manual edit conflict warning */}
        {hasConflicts && (
          <div className="mx-6 mb-4 p-4 rounded-xl bg-amber-900/20 border border-amber-500/30">
            <div className="flex items-start gap-2.5 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-200">
                  {conflictingIds.size} task{conflictingIds.size !== 1 ? 's' : ''} you edited will be affected
                </p>
                <p className="text-xs text-amber-400/70 mt-0.5">
                  The AI wants to modify or remove tasks you've manually edited.
                </p>
              </div>
            </div>
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative shrink-0">
                <input
                  type="checkbox"
                  checked={keepManualEdits}
                  onChange={onToggleKeepManualEdits}
                  className="sr-only peer"
                />
                <div className="w-4 h-4 rounded border border-white/20 bg-white/5 peer-checked:border-purple-500 peer-checked:bg-purple-600 transition-all flex items-center justify-center">
                  {keepManualEdits && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
              </div>
              <span className="text-sm text-amber-200/80 group-hover:text-amber-200 transition-colors">
                Keep my edits — skip AI changes to tasks I've modified
              </span>
            </label>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            type="button"
            onClick={onApply}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-all hover:-translate-y-0.5 active:translate-y-0 shadow-lg shadow-purple-500/20"
          >
            <Check className="w-4 h-4" />
            Apply changes
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center justify-center gap-2 py-3 px-5 rounded-2xl border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/25 text-sm font-medium transition-all"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
