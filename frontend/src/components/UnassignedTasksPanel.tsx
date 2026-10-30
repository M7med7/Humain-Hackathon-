import { useState } from "react";
import { motion } from "motion/react";
import { UserPlus, ChevronDown, Zap } from "lucide-react";
import type { Task } from "../lib/api";
import type { TeamMember } from "../lib/teamUtils";
import { suggestOwner } from "../lib/teamUtils";
import { useTranslation } from "react-i18next";

interface UnassignedTasksPanelProps {
  tasks: Task[];
  members: TeamMember[];
  maxSP: number;
  perMemberMaxSP: Record<string, number>;
  onAssign: (taskId: string, memberId: string) => Promise<void>;
}

export function UnassignedTasksPanel({
  tasks, members, maxSP, perMemberMaxSP, onAssign,
}: UnassignedTasksPanelProps) {
  const { t } = useTranslation("team");
  const [open, setOpen] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const unassigned = tasks.filter((t) => !t.assigned_to && t.status !== "Done");

  if (unassigned.length === 0) return null;

  async function handleAssign(taskId: string, memberId: string) {
    setAssigningId(taskId);
    try {
      await onAssign(taskId, memberId);
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 rounded-2xl border border-purple-500/25 bg-purple-900/8 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-4 p-5 text-left"
      >
        <div className="p-2.5 bg-purple-900/40 rounded-xl border border-purple-500/30 shrink-0">
          <UserPlus className="w-5 h-5 text-purple-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-purple-300">{t("unassigned.title")}</h3>
          <p className="text-sm text-gray-400 mt-0.5">
            {t("unassigned.description", { count: unassigned.length })}
          </p>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3 border-t border-purple-500/15">
          {unassigned.slice(0, 10).map((task) => {
            const suggestion = suggestOwner(task, members, maxSP, perMemberMaxSP);
            const isAssigning = assigningId === task.id;

            return (
              <div key={task.id} className="rounded-xl app-surface-soft border border-white/8 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-200 truncate">{task.title}</div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {task.assigned_tech.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] text-gray-500 bg-white/5 border border-white/10 rounded px-1.5 py-0.5"
                        >
                          {t}
                        </span>
                      ))}
                      {task.assigned_tech.length === 0 && (
                        <span className="text-[10px] text-gray-600 italic">{t("unassigned.noTech")}</span>
                      )}
                    </div>
                  </div>

                  {suggestion && (
                    <button
                      onClick={() => handleAssign(task.id, suggestion.member.id)}
                      disabled={isAssigning}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-900/40 hover:bg-purple-800/60 border border-purple-500/30 text-xs text-purple-200 transition-all disabled:opacity-50"
                    >
                      {isAssigning ? (
                        <div className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Zap className="w-3 h-3" />
                      )}
                      {suggestion.member.name.split(" ")[0]}
                    </button>
                  )}
                </div>

                {suggestion && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                    <span
                      className={`font-medium ${
                        suggestion.skillScore >= 70
                          ? "text-emerald-400"
                          : suggestion.skillScore >= 40
                          ? "text-amber-400"
                          : "text-red-400"
                      }`}
                    >
                      {t("unassigned.skillMatch", { count: suggestion.skillScore })}
                    </span>
                    <span>·</span>
                    <span className={suggestion.capacityPct >= 30 ? "text-green-400" : "text-amber-400"}>
                      {t("unassigned.capacityFree", { count: suggestion.capacityPct })}
                    </span>
                    {task.project_name && (
                      <>
                        <span>·</span>
                        <span className="truncate">{task.project_name}</span>
                      </>
                    )}
                  </div>
                )}

                {!suggestion && (
                  <div className="mt-2 text-[11px] text-gray-600 italic">
                    {t("unassigned.noneAvailable")}
                  </div>
                )}
              </div>
            );
          })}

          {unassigned.length > 10 && (
            <p className="text-xs text-gray-600 text-center pt-1">
              {t("unassigned.more", { count: unassigned.length - 10 })}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}
