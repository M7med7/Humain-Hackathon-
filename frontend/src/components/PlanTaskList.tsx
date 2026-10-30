import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, ChevronRight, Clock, Edit3 } from "lucide-react";
import type { AssignmentRecommendation, GeneratedTask } from "../lib/api";
import { AssigneeSelector } from "./AssigneeSelector";

interface PlanTaskListProps {
  tasks: GeneratedTask[];
  memberNames: Map<string, string>;
  manuallyEditedTaskIds: ReadonlySet<string>;
  assigneeOverrides: ReadonlySet<string>; // task IDs where user overrode the recommendation
  recommendations: Record<string, AssignmentRecommendation>;
  onTaskEdit: (taskId: string, field: keyof GeneratedTask, value: string | number) => void;
  onAssigneeChange: (taskId: string, userId: string) => void;
}

const PRIORITY_STYLES: Record<string, string> = {
  High: 'bg-red-900/40 border-red-500/40 text-red-300',
  Medium: 'bg-amber-900/30 border-amber-500/30 text-amber-300',
  Low: 'bg-blue-900/30 border-blue-500/30 text-blue-300',
};

function EditableField({
  value,
  onSave,
  type = 'text',
  min,
}: {
  value: string | number;
  onSave: (v: string | number) => void;
  type?: 'text' | 'number';
  min?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const final = type === 'number' ? Math.max(min ?? 1, Number(draft) || 1) : draft.trim();
    if (String(final) !== String(value)) onSave(final);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type={type}
        min={min}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="bg-white/10 border border-purple-500/50 rounded px-2 py-0.5 text-sm text-white focus:outline-none w-full"
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      className="cursor-pointer hover:text-white hover:underline decoration-dotted transition-colors"
    >
      {value}
    </span>
  );
}

function TaskRow({
  task,
  memberNames,
  isManuallyEdited,
  isAssigneeOverridden,
  recommendation,
  onTaskEdit,
  onAssigneeChange,
}: {
  task: GeneratedTask;
  memberNames: Map<string, string>;
  isManuallyEdited: boolean;
  isAssigneeOverridden: boolean;
  recommendation: AssignmentRecommendation | undefined;
  onTaskEdit: (taskId: string, field: keyof GeneratedTask, value: string | number) => void;
  onAssigneeChange: (taskId: string, userId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const priority = task.priority ?? 'Medium';

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${isManuallyEdited
      ? 'border-purple-500/40 bg-purple-900/10'
      : 'border-white/8 bg-white/3'
      }`}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/4 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Expand toggle */}
        <span className="text-gray-600 shrink-0">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>

        {/* Title */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-sm text-gray-200 truncate font-medium">{task.title}</span>
          {isManuallyEdited && (
            <span className="shrink-0 flex items-center gap-1 text-[10px] text-purple-400 bg-purple-900/30 border border-purple-500/30 rounded px-1.5 py-0.5">
              <Edit3 className="w-2.5 h-2.5" />
              edited
            </span>
          )}
        </div>

        {/* Meta chips */}
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PRIORITY_STYLES[priority] ?? PRIORITY_STYLES['Medium']}`}>
            {priority}
          </span>
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Clock className="w-3 h-3" />
            {task.estimated_days}d
          </span>

          {/* Assignee selector replaces the static chip */}
          {task.assigned_to && (
            <AssigneeSelector
              taskId={task.id}
              currentAssigneeId={task.assigned_to}
              recommendation={recommendation}
              memberNames={memberNames}
              isOverridden={isAssigneeOverridden}
              onAssigneeChange={onAssigneeChange}
            />
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div
              className="px-4 pb-4 pt-2 border-t border-white/5 grid gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Editable title */}
              <div>
                <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-1 block">Title</label>
                <div className="text-sm text-gray-300">
                  <EditableField
                    value={task.title}
                    onSave={(v) => onTaskEdit(task.id, 'title', v)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Duration */}
                <div>
                  <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-1 block">Days</label>
                  <div className="text-sm text-gray-300">
                    <EditableField
                      value={task.estimated_days}
                      onSave={(v) => onTaskEdit(task.id, 'estimated_days', v)}
                      type="number"
                      min={1}
                    />
                  </div>
                </div>

                {/* Priority */}
                <div>
                  <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-1 block">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => onTaskEdit(task.id, 'priority' as keyof GeneratedTask, e.target.value)}
                    className="bg-white/8 border border-white/10 rounded px-2 py-0.5 text-sm text-gray-300 focus:outline-none focus:border-purple-500/50 cursor-pointer"
                  >
                    {['High', 'Medium', 'Low'].map((p) => (
                      <option key={p} value={p} className="bg-gray-900">{p}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Assignee (expanded) */}
              {task.assigned_to && (
                <div>
                  <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-1.5 block">Assignee</label>
                  <AssigneeSelector
                    taskId={task.id}
                    currentAssigneeId={task.assigned_to}
                    recommendation={recommendation}
                    memberNames={memberNames}
                    isOverridden={isAssigneeOverridden}
                    onAssigneeChange={onAssigneeChange}
                  />
                </div>
              )}

              {/* Description */}
              {task.description && (
                <div>
                  <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-1 block">Description</label>
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">{task.description.split('\n')[0]}</p>
                </div>
              )}

              {/* Tech */}
              {task.assigned_tech.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {task.assigned_tech.map((t) => (
                    <span key={t} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-gray-400">{t}</span>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PlanTaskList({
  tasks,
  memberNames,
  manuallyEditedTaskIds,
  assigneeOverrides,
  recommendations,
  onTaskEdit,
  onAssigneeChange,
}: PlanTaskListProps) {
  const [collapsed, setCollapsed] = useState(false);
  const editedCount = tasks.filter((t) => manuallyEditedTaskIds.has(t.id)).length;

  return (
    <div className="space-y-2">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left group"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-300">Task List</span>
          <span className="text-xs text-gray-600">{tasks.length} tasks</span>
          {editedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 border border-purple-500/30 text-purple-300">
              {editedCount} edited
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-600 group-hover:text-gray-400 transition-colors">
          <span>Click any task to edit</span>
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden space-y-1.5"
          >
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                memberNames={memberNames}
                isManuallyEdited={manuallyEditedTaskIds.has(task.id)}
                isAssigneeOverridden={assigneeOverrides.has(task.id)}
                recommendation={recommendations[task.id]}
                onTaskEdit={onTaskEdit}
                onAssigneeChange={onAssigneeChange}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
