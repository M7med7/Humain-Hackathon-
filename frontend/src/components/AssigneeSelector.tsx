import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, Check, ChevronDown, Sparkles, User } from "lucide-react";
import type { AssignmentRecommendation } from "../lib/api";

interface AssigneeSelectorProps {
  taskId: string;
  currentAssigneeId: string;
  recommendation: AssignmentRecommendation | undefined;
  memberNames: Map<string, string>; // userId → displayName
  isOverridden: boolean;
  onAssigneeChange: (taskId: string, userId: string) => void;
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 80) return "Best fit";
  if (confidence >= 60) return "Good match";
  if (confidence >= 40) return "Partial";
  return "Weak";
}

function confidenceColor(confidence: number): string {
  if (confidence >= 80) return "text-green-400 bg-green-900/30 border-green-500/30";
  if (confidence >= 60) return "text-purple-300 bg-purple-900/30 border-purple-500/30";
  if (confidence >= 40) return "text-amber-300 bg-amber-900/30 border-amber-500/30";
  return "text-red-300 bg-red-900/30 border-red-500/30";
}

export function AssigneeSelector({
  taskId,
  currentAssigneeId,
  recommendation,
  memberNames,
  isOverridden,
  onAssigneeChange,
}: AssigneeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentName =
    memberNames.get(currentAssigneeId) ?? currentAssigneeId.slice(0, 8) ?? "Unassigned";

  const isRecommended = recommendation?.userId === currentAssigneeId;
  const hasWeakMatch = recommendation && recommendation.confidence < 40;
  const noMatchAtAll = !recommendation;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const members = Array.from(memberNames.entries());

  return (
    <div ref={containerRef} className="relative" onClick={(e) => e.stopPropagation()}>
      {/* Current assignee chip */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1 border transition-colors ${
          open
            ? "border-purple-500/50 bg-purple-900/20 text-purple-200"
            : "border-white/10 app-surface-soft text-gray-400 hover:border-white/20 hover:text-gray-300"
        }`}
      >
        <User className="w-3 h-3 shrink-0" />
        <span className="max-w-[90px] truncate">{currentName}</span>

        {isRecommended && !isOverridden && (
          <span className="flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded bg-purple-900/50 border border-purple-500/30 text-purple-300 shrink-0">
            <Sparkles className="w-2.5 h-2.5" />
            {recommendation.confidence}%
          </span>
        )}

        {isOverridden && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-amber-900/30 border border-amber-500/30 text-amber-400 shrink-0">
            override
          </span>
        )}

        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* "Recommended because…" inline hint */}
      {isRecommended && !isOverridden && recommendation && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowReason((v) => !v); }}
          className="block mt-0.5 text-[10px] text-purple-500 hover:text-purple-300 transition-colors"
        >
          {showReason ? "Hide reason" : "Recommended because…"}
        </button>
      )}

      <AnimatePresence>
        {isRecommended && !isOverridden && recommendation && showReason && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="mt-1 p-2.5 rounded-lg bg-purple-900/20 border border-purple-500/20 text-[11px] text-purple-200/80 leading-relaxed space-y-1.5"
          >
            <p>{recommendation.reason}</p>

            {recommendation.skillMatches.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {recommendation.skillMatches.slice(0, 4).map((s) => (
                  <span key={s} className="px-1.5 py-0.5 rounded bg-green-900/30 border border-green-500/25 text-green-300">
                    {s}
                  </span>
                ))}
              </div>
            )}

            {recommendation.skillGaps.length > 0 && (
              <p className="text-amber-400/70">
                Gaps: {recommendation.skillGaps.slice(0, 3).join(", ")}
                {recommendation.skillGaps.length > 3 ? " …" : ""}
              </p>
            )}

            {recommendation.overloadWarning && (
              <p className="flex items-center gap-1 text-red-400/80">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                {recommendation.overloadWarning}
              </p>
            )}

            {recommendation.trainingSuggestion && (
              <p className="text-amber-300/75">{recommendation.trainingSuggestion}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Weak / no-match warning */}
      {(hasWeakMatch || noMatchAtAll) && !open && (
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-500/70">
          <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
          {noMatchAtAll ? "No skill data available" : "No strong match — review skills"}
        </p>
      )}

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full mt-1.5 z-30 w-64 bg-[#0e0e14] border border-white/12 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="px-3 pt-2.5 pb-1 border-b border-white/6">
              <p className="text-[11px] text-gray-500">Select assignee — ranked by fit</p>
            </div>

            <div className="py-1 max-h-52 overflow-y-auto">
              {members
                .slice()
                .sort(([aId], [bId]) => {
                  // recommended first, then by confidence desc
                  const aConf = recommendation?.userId === aId ? (recommendation?.confidence ?? 0) : -1;
                  const bConf = recommendation?.userId === bId ? (recommendation?.confidence ?? 0) : -1;
                  return bConf - aConf;
                })
                .map(([userId, name]) => {
                  const rec = recommendation?.userId === userId ? recommendation : undefined;
                  const isSelected = userId === currentAssigneeId;

                  return (
                    <button
                      key={userId}
                      type="button"
                      onClick={() => { onAssigneeChange(taskId, userId); setOpen(false); setShowReason(false); }}
                      className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "bg-purple-900/20 text-white"
                          : "text-gray-300 hover:app-surface-soft hover:text-white"
                      }`}
                    >
                      <div className="shrink-0 w-4 h-4 mt-0.5 flex items-center justify-center">
                        {isSelected && <Check className="w-3.5 h-3.5 text-purple-400" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium truncate">{name}</span>
                          {rec && (
                            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${confidenceColor(rec.confidence)}`}>
                              {confidenceLabel(rec.confidence)} · {rec.confidence}%
                            </span>
                          )}
                        </div>

                        {rec && (
                          <p className="text-[11px] text-gray-500 mt-0.5 leading-snug line-clamp-2">
                            {rec.reason}
                          </p>
                        )}

                        {rec && rec.skillGaps.length > 0 && (
                          <p className="text-[10px] text-amber-500/60 mt-0.5">
                            Gaps: {rec.skillGaps.slice(0, 2).join(", ")}
                            {rec.skillGaps.length > 2 ? " …" : ""}
                          </p>
                        )}

                        {rec?.trainingSuggestion && (
                          <p className="text-[10px] text-amber-400/60 mt-0.5 line-clamp-1">
                            {rec.trainingSuggestion}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
