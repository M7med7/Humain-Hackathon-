import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, Trash2, ChevronDown, Calendar, X, Plus } from "lucide-react";
import type { Task } from "../lib/api";
import type { TeamMember } from "../lib/teamUtils";
import {
  computeCapacity,
  workloadForecast,
  overloadReasons,
  avgSkillMatch,
  deliveryMomentum,
} from "../lib/teamUtils";
import { useTranslation } from "react-i18next";

interface AvailabilityRange {
  id: string;
  label: string;
  from: string;
  to: string;
}

function loadAvailability(memberId: string): AvailabilityRange[] {
  try {
    const raw = localStorage.getItem(`avail-${memberId}`);
    return raw ? (JSON.parse(raw) as AvailabilityRange[]) : [];
  } catch {
    return [];
  }
}

function saveAvailability(memberId: string, ranges: AvailabilityRange[]) {
  localStorage.setItem(`avail-${memberId}`, JSON.stringify(ranges));
}

function weekStartDate(weekOffset: number): Date {
  const now = new Date();
  const d = new Date(now);
  d.setDate(now.getDate() - now.getDay() + weekOffset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface MemberCardProps {
  member: TeamMember;
  allTasks: Task[];
  effectiveMaxSP: number;
  isCurrentUser: boolean;
  canDelete: boolean;
  index: number;
  onDelete: () => void;
  onUploadCV: (memberId: string, file: File) => void;
  uploadingCVId: string | null;
  uploadError: string | null;
  onMaxSPChange: (memberId: string, value: number) => void;
}

export function MemberCard({
  member, allTasks, effectiveMaxSP,
  isCurrentUser, canDelete, index,
  onDelete, onUploadCV, uploadingCVId, uploadError, onMaxSPChange,
}: MemberCardProps) {
  const { t } = useTranslation("team");
  const [showDetails, setShowDetails] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityRange[]>(() => loadAvailability(member.id));
  const [newRange, setNewRange] = useState({ label: "", from: "", to: "" });

  const capacity = computeCapacity(member.storyPoints, effectiveMaxSP);
  const isOverloaded = capacity > 90;

  const forecast = useMemo(() => workloadForecast(allTasks, member.id, 5), [allTasks, member.id]);
  const maxBar = Math.max(...forecast.map((f) => f.load), effectiveMaxSP, 1);

  const reasons = useMemo(
    () => (isOverloaded ? overloadReasons(member, allTasks, member.id, effectiveMaxSP) : []),
    [isOverloaded, member, allTasks, effectiveMaxSP]
  );

  const momentum = useMemo(
    () => deliveryMomentum(member.completedCount, member.taskCount),
    [member.completedCount, member.taskCount]
  );

  const skillScore = useMemo(
    () => avgSkillMatch(member.skills, allTasks, member.id),
    [member.skills, allTasks, member.id]
  );

  function weekHasUnavailability(weekOffset: number): boolean {
    if (availability.length === 0) return false;
    const ws = weekStartDate(weekOffset);
    const we = new Date(ws);
    we.setDate(we.getDate() + 6);
    return availability.some((a) => {
      const aF = new Date(a.from).getTime();
      const aT = new Date(a.to).getTime();
      return aF <= we.getTime() && aT >= ws.getTime();
    });
  }

  function addRange() {
    if (!newRange.from || !newRange.to) return;
    const updated = [
      ...availability,
      { id: String(Date.now()), label: newRange.label || "Away", from: newRange.from, to: newRange.to },
    ];
    setAvailability(updated);
    saveAvailability(member.id, updated);
    setNewRange({ label: "", from: "", to: "" });
  }

  function removeRange(id: string) {
    const updated = availability.filter((a) => a.id !== id);
    setAvailability(updated);
    saveAvailability(member.id, updated);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, type: "spring", stiffness: 100 }}
      className={`relative bg-linear-to-br from-white/7 to-white/2 backdrop-blur-2xl border-2 rounded-3xl p-7 transition-all duration-300 group ${
        isOverloaded
          ? "border-red-500/50 shadow-xl shadow-red-500/20"
          : "border-white/20 hover:border-white/30 shadow-xl"
      }`}
    >
      {canDelete && (
        <button
          onClick={onDelete}
          className="absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 app-surface-elevated text-gray-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:border-red-500/50 hover:bg-red-900/30 hover:text-red-400 transition-all"
          aria-label={`Remove ${member.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div
          className={`w-16 h-16 rounded-2xl bg-linear-to-br ${member.gradient} flex items-center justify-center shadow-xl overflow-hidden shrink-0`}
        >
          {member.avatar_url ? (
            <img src={member.avatar_url} alt={member.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xl text-white font-bold">{member.avatar}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold truncate">{member.name}</h3>
          <p className="text-xs text-gray-400 truncate">{member.role}</p>
          {member.phone && <p className="text-xs text-gray-500 truncate">{member.phone}</p>}
        </div>
        <span
          className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold ${momentum.bgColor} ${momentum.borderColor} ${momentum.color}`}
          title={t("card.momentumTitle")}
        >
          {momentum.label}
        </span>
      </div>

      {/* Capacity */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400 font-semibold">{t("card.capacity")}</span>
          <div className="flex items-center gap-1">
            <span
              className={`text-sm font-bold ${
                isOverloaded ? "text-red-400" : capacity > 75 ? "text-yellow-400" : "text-green-400"
              }`}
            >
              {capacity}%
            </span>
            <span className="text-xs text-gray-600 ml-1">{member.storyPoints}/</span>
            <input
              type="number"
              min="1"
              max="200"
              value={effectiveMaxSP}
              onChange={(e) => onMaxSPChange(member.id, Math.max(1, parseInt(e.target.value, 10) || 1))}
              onClick={(e) => e.stopPropagation()}
              className="w-9 bg-transparent text-xs text-gray-400 outline-none text-right border-b border-white/10 focus:border-purple-400/50"
              title={t("card.maxSpTitle")}
            />
            <span className="text-xs text-gray-600">SP</span>
          </div>
        </div>
        <div className="h-3 app-input rounded-full overflow-hidden border border-white/10">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${capacity}%` }}
            transition={{ delay: index * 0.08 + 0.3, duration: 1, ease: "easeOut" }}
            className={`h-full rounded-full ${
              isOverloaded
                ? "bg-linear-to-r from-red-600 to-orange-600 shadow-lg shadow-red-500/50"
                : capacity > 75
                ? "bg-linear-to-r from-yellow-600 to-orange-600 shadow-lg shadow-yellow-500/50"
                : "bg-linear-to-r from-green-600 to-emerald-600 shadow-lg shadow-green-500/50"
            }`}
          />
        </div>
        {reasons.length > 0 && (
          <div className="mt-2 space-y-1">
            {reasons.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-red-400">
                <span className="w-1 h-1 rounded-full bg-red-400 shrink-0" />
                {r.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Workload forecast */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">{t("card.forecast")}</span>
          {skillScore >= 0 && (
            <span className="text-[10px] text-gray-500">
              {t("card.skillFit")}: {" "}
              <span className={`font-semibold ${skillScore >= 70 ? "text-emerald-400" : skillScore >= 40 ? "text-amber-400" : "text-red-400"}`}>
                {skillScore}%
              </span>
            </span>
          )}
          {skillScore < 0 && member.skills.length === 0 && (
            <span className="text-[10px] text-gray-600 italic">{t("card.uploadCv")}</span>
          )}
        </div>
        <div className="flex items-end gap-1.5 h-12">
          {forecast.map((w, i) => {
            const pct = (w.load / maxBar) * 100;
            const overMax = w.load > effectiveMaxSP;
            const nearMax = w.load > effectiveMaxSP * 0.75;
            const barColor = overMax
              ? "bg-red-500/70"
              : nearMax
              ? "bg-yellow-500/70"
              : "bg-purple-500/60";
            const unavail = weekHasUnavailability(i);
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col justify-end h-9 relative">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: w.load > 0 ? `${Math.max(pct, 12)}%` : "4px" }}
                    transition={{ delay: index * 0.08 + i * 0.06 + 0.5, duration: 0.5, ease: "easeOut" }}
                    className={`w-full rounded-t ${barColor} ${w.load === 0 ? "opacity-20" : ""} ${unavail ? "ring-1 ring-amber-400/60" : ""}`}
                  />
                  {unavail && (
                    <span
                      className="absolute -top-1.5 right-0 w-2 h-2 rounded-full bg-amber-400"
                      title="Has unavailable days this week"
                    />
                  )}
                </div>
                <span className="text-[9px] text-gray-600 truncate w-full text-center">{w.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="rounded-xl bg-white/5 border border-white/8 p-3 text-center">
          <div className="text-lg font-bold text-white">{member.taskCount}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{t("card.active")}</div>
        </div>
        <div className="rounded-xl bg-white/5 border border-white/8 p-3 text-center">
          <div className="text-lg font-bold text-white">{member.projectCount}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{t("card.projects")}</div>
        </div>
        <div className="rounded-xl bg-white/5 border border-white/8 p-3 text-center">
          <div className="text-lg font-bold text-green-400">{member.completedCount}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{t("card.done")}</div>
        </div>
      </div>

      {/* Expandable details */}
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="w-full flex items-center justify-between text-sm text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span className="font-semibold">{t("card.skillsAvailability")}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-4 border-t border-white/10 mt-3 space-y-4">
              {/* Skills */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 mb-2">{t("card.skills")}</h4>
                {member.skills.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {member.skills.map((skill, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-white/8 border border-white/10 rounded-full text-[11px] text-gray-300"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 italic">{t("card.noCv")}</p>
                )}
              </div>

              {/* Experience */}
              {member.experienceSummary && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 mb-1">{t("card.experience")}</h4>
                  <p className="text-xs text-gray-500 leading-relaxed">{member.experienceSummary}</p>
                </div>
              )}

              {/* CV upload */}
              {!member.isLocal && isCurrentUser && (
                <div>
                  {uploadError && <p className="text-red-400 text-xs mb-2">{uploadError}</p>}
                  {uploadingCVId === member.id ? (
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-400">
                      <div className="w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                      Parsing CV…
                    </div>
                  ) : (
                    <label className="inline-flex items-center cursor-pointer px-3 py-1.5 bg-purple-900/40 hover:bg-purple-800/60 border border-purple-500/30 rounded-lg text-xs text-purple-300 transition-colors">
                      {member.cvParsedAt ? "Re-upload CV" : "Upload CV"}
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.txt"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) onUploadCV(member.id, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
              )}

              {/* Completed tasks */}
              {member.completedTasks.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 mb-2">
                    Recently Completed
                  </h4>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {member.completedTasks.slice(0, 5).map((ct) => (
                      <div
                        key={ct.id}
                        className="flex items-start gap-2 px-3 py-2 bg-green-900/15 rounded-lg border border-green-500/15"
                      >
                        <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs text-gray-300 truncate">{ct.title}</div>
                          {ct.project_name && (
                            <div className="text-[10px] text-gray-600 truncate">{ct.project_name}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unavailable periods */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAvailability((v) => !v)}
                  className="flex w-full items-center gap-2 text-xs text-gray-400 hover:text-gray-200 transition-colors mb-2"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span className="font-semibold">{t("card.unavailable")}</span>
                  {availability.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-900/30 border border-amber-500/30 text-amber-400 text-[10px]">
                      {availability.length}
                    </span>
                  )}
                  <ChevronDown
                    className={`w-3 h-3 ml-auto transition-transform ${showAvailability ? "rotate-180" : ""}`}
                  />
                </button>
                <AnimatePresence>
                  {showAvailability && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-2">
                        {availability.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center gap-2 rounded-lg bg-amber-900/15 border border-amber-500/20 px-3 py-2"
                          >
                            <span className="text-xs text-amber-300 font-medium flex-1 truncate">{a.label}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">{a.from} → {a.to}</span>
                            <button
                              onClick={() => removeRange(a.id)}
                              className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            placeholder={t("card.label")}
                            value={newRange.label}
                            onChange={(e) => setNewRange((p) => ({ ...p, label: e.target.value }))}
                            className="flex-1 min-w-0 text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white placeholder-gray-600 outline-none focus:border-purple-400/40"
                          />
                          <input
                            type="date"
                            value={newRange.from}
                            onChange={(e) => setNewRange((p) => ({ ...p, from: e.target.value }))}
                            className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white outline-none focus:border-purple-400/40 w-28"
                          />
                          <input
                            type="date"
                            value={newRange.to}
                            onChange={(e) => setNewRange((p) => ({ ...p, to: e.target.value }))}
                            className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white outline-none focus:border-purple-400/40 w-28"
                          />
                          <button
                            onClick={addRange}
                            disabled={!newRange.from || !newRange.to}
                            className="p-1.5 rounded-lg bg-purple-900/40 border border-purple-500/30 text-purple-300 hover:bg-purple-800/60 disabled:opacity-30 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
