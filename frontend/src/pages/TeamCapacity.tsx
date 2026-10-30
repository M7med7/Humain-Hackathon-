import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertCircle, AlertTriangle, Plus, X } from "lucide-react";
import { api, type User } from "../lib/api";
import { readLocalTeamMembers, removeLocalTeamMember, type StoredTeamMember } from "../lib/localTeamMembers";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useSpaces } from "../contexts/SpaceContext";
import { computeCapacity, getInitials, type TeamMember } from "../lib/teamUtils";
import { MemberCard } from "../components/MemberCard";
import { SkillGapPanel } from "../components/SkillGapPanel";
import { UnassignedTasksPanel } from "../components/UnassignedTasksPanel";
import type { Task } from "../lib/api";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

const GRADIENTS = [
  "from-purple-600 to-purple-800",
  "from-purple-600 to-pink-600",
  "from-green-600 to-emerald-600",
  "from-orange-600 to-red-600",
  "from-indigo-600 to-purple-600",
  "from-purple-500 to-purple-700",
];

const PER_MEMBER_SP_KEY = "team-member-max-sp";

function loadPerMemberMaxSP(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PER_MEMBER_SP_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function mapUser(user: User, index: number): TeamMember {
  return {
    id: user.id,
    name: user.full_name ?? user.email,
    role: user.email,
    phone: user.phone ?? undefined,
    storyPoints: user.total_estimated_days ?? 0,
    avatar: getInitials(user.full_name, user.email),
    avatar_url: user.avatar_url,
    taskCount: user.task_count,
    projectCount: user.project_count,
    completedCount: user.completed_count ?? 0,
    completedTasks: (user.completed_tasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      project_name: t.project_name,
    })),
    gradient: GRADIENTS[index % GRADIENTS.length],
    isLocal: false,
    skills: user.skills ?? [],
    experienceSummary: user.experience_summary ?? null,
    cvParsedAt: user.cv_parsed_at ?? null,
  };
}

function mapStoredMember(member: StoredTeamMember, index: number): TeamMember {
  return {
    id: member.id,
    name: member.full_name,
    role: member.email,
    phone: member.phone,
    storyPoints: 0,
    avatar: getInitials(member.full_name, member.email),
    avatar_url: null,
    taskCount: member.task_count,
    projectCount: 0,
    completedCount: 0,
    completedTasks: [],
    gradient: GRADIENTS[index % GRADIENTS.length],
    isLocal: true,
    skills: [],
    experienceSummary: null,
    cvParsedAt: null,
  };
}

function ConfirmDeleteModal({
  memberName, onConfirm, onCancel, deleting, t,
}: {
  memberName: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
  t: TFunction;
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
            <h3 className="text-lg font-semibold text-white">{t("remove.title")}</h3>
            <p className="mt-1 text-sm text-gray-400">
              {t("remove.description", { name: memberName })}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="ml-auto rounded-lg border border-white/10 p-1.5 text-gray-400 hover:text-white hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-white/5 hover:text-white disabled:opacity-40"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-xl bg-red-600 hover:bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-500/20 disabled:opacity-40 transition-colors"
          >
            {deleting ? t("remove.removing") : t("remove.action")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function TeamCapacity() {
  const { t } = useTranslation(["team", "common"]);
  const { session } = useAuth();
  const currentUserId = session?.user.id;
  const navigate = useNavigate();
  const { activeSpace, isAdmin } = useSpaces();
  const activeSpaceId = activeSpace?.id ?? "";

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadingCVId, setUploadingCVId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [perMemberMaxSP, setPerMemberMaxSP] = useState<Record<string, number>>(loadPerMemberMaxSP);

  const [maxStoryPointsInput, setMaxStoryPointsInput] = useState<string>(() => {
    return localStorage.getItem("maxStoryPoints") ?? "40";
  });
  const maxStoryPoints = Math.max(1, parseInt(maxStoryPointsInput, 10) || 1);

  useEffect(() => {
    localStorage.setItem("maxStoryPoints", maxStoryPoints.toString());
  }, [maxStoryPoints]);

  useEffect(() => {
    localStorage.setItem(PER_MEMBER_SP_KEY, JSON.stringify(perMemberMaxSP));
  }, [perMemberMaxSP]);

  const fetchData = () => {
    Promise.all([api.users.list(), api.tasks.list()])
      .then(([{ users }, { tasks }]) => {
        const apiMembers = users.map((u, i) => mapUser(u, i));
        const storedMembers = readLocalTeamMembers().map((m, i) =>
          mapStoredMember(m, apiMembers.length + i)
        );
        setMembers([...apiMembers, ...storedMembers]);
        setAllTasks(tasks);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    const onVisibility = () => { if (!document.hidden) fetchData(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("userProfileUpdated", fetchData);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("userProfileUpdated", fetchData);
    };
  }, []);

  const handleUploadCV = async (memberId: string, file: File) => {
    try {
      setUploadingCVId(memberId);
      setUploadError(null);
      const res = await api.users.uploadCV(memberId, file);
      if (res.success) {
        setMembers((prev) =>
          prev.map((m) =>
            m.id === memberId
              ? { ...m, skills: res.skills, experienceSummary: res.experience_summary, cvParsedAt: new Date().toISOString() }
              : m
          )
        );
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t("team:uploadFailed"));
    } finally {
      setUploadingCVId(null);
    }
  };

  const handleAssign = async (taskId: string, memberId: string) => {
    await api.tasks.assign(taskId, memberId, currentUserId);
    setAllTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, assigned_to: memberId } : t)));
  };

  const handleMaxSPChange = (memberId: string, value: number) => {
    setPerMemberMaxSP((prev) => ({ ...prev, [memberId]: value }));
  };

  const handleDelete = async () => {
    if (!confirmId) return;
    const member = members.find((m) => m.id === confirmId);
    if (!member) return;
    setDeletingId(confirmId);
    try {
      if (member.isLocal) {
        removeLocalTeamMember(confirmId);
      } else {
        await api.spaces.removeMember(activeSpaceId, confirmId);
      }
      setMembers((prev) => prev.filter((m) => m.id !== confirmId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("team:remove.failed"));
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  };

  const overloaded = useMemo(
    () => members.filter((m) => computeCapacity(m.storyPoints, perMemberMaxSP[m.id] ?? maxStoryPoints) > 90),
    [members, maxStoryPoints, perMemberMaxSP]
  );
  const available = members.filter(
    (m) => computeCapacity(m.storyPoints, perMemberMaxSP[m.id] ?? maxStoryPoints) <= 90
  );
  const totalCompleted = members.reduce((sum, m) => sum + m.completedCount, 0);
  const confirmMember = confirmId ? members.find((m) => m.id === confirmId) : null;

  return (
    <div className="p-4 md:p-8 lg:p-12">
      {/* Header */}
      <div className="mb-8 md:mb-12 flex flex-col lg:flex-row lg:items-start justify-between gap-4 md:gap-6">
        <div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl mb-2 md:mb-3 font-semibold text-white">
            {t("team:title")}
          </h2>
          <p className="text-gray-500 text-sm md:text-lg">{t("team:description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 shadow-lg">
            <span className="text-sm font-semibold text-gray-400">{t("team:teamMaxSp")}</span>
            <input
              type="number"
              min="1"
              value={maxStoryPointsInput}
              onChange={(e) => setMaxStoryPointsInput(e.target.value)}
              className="w-16 bg-transparent text-lg text-white font-bold outline-none"
            />
          </div>
          {isAdmin && (
          <motion.button
            type="button"
            onClick={() => navigate("/space")}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="inline-flex items-center gap-3 rounded-xl border border-purple-500/40 bg-purple-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/15 hover:bg-purple-500 transition-all"
          >
            <Plus className="h-4 w-4" />
            {t("team:addMember")}
          </motion.button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-8 p-4 bg-red-900/30 border border-red-500/50 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-48 text-gray-500">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">{t("team:loading")}</p>
          </div>
        </div>
      )}

      {!loading && !error && members.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 text-gray-500">
          <p className="text-xl mb-2">{t("team:emptyTitle")}</p>
          <p className="text-sm">{t("team:emptyDescription")}</p>
        </div>
      )}

      {/* Overload alert */}
      {overloaded.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-linear-to-r from-red-900/30 to-orange-900/30 border-2 border-red-500/50 rounded-2xl md:rounded-3xl p-5 md:p-8 shadow-2xl shadow-red-500/20"
        >
          <div className="flex items-center gap-4 mb-3">
            <div className="p-3 bg-red-600 rounded-2xl shrink-0">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl text-red-300 font-semibold">{t("team:capacityAlert")}</h3>
              <p className="text-sm text-gray-400 mt-0.5">
                {t("team:capacityAlert", { count: overloaded.length })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {overloaded.map((m) => (
              <span
                key={m.id}
                className="px-4 py-1.5 bg-linear-to-r from-red-600 to-orange-600 rounded-full text-sm text-white font-semibold shadow"
              >
                {m.name} ({computeCapacity(m.storyPoints, perMemberMaxSP[m.id] ?? maxStoryPoints)}%)
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {/* Skill gap + unassigned panels */}
      {!loading && (
        <>
          <SkillGapPanel members={members} tasks={allTasks} />
          <UnassignedTasksPanel
            tasks={allTasks}
            members={members}
            maxSP={maxStoryPoints}
            perMemberMaxSP={perMemberMaxSP}
            onAssign={handleAssign}
          />
        </>
      )}

      {/* Member cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-10">
        {members.map((member, index) => (
          <MemberCard
            key={member.id}
            member={member}
            allTasks={allTasks}
            effectiveMaxSP={perMemberMaxSP[member.id] ?? maxStoryPoints}
            isCurrentUser={member.id === currentUserId}
            canDelete={isAdmin && member.id !== currentUserId}
            index={index}
            onDelete={() => setConfirmId(member.id)}
            onUploadCV={handleUploadCV}
            uploadingCVId={uploadingCVId}
            uploadError={uploadError}
            onMaxSPChange={handleMaxSPChange}
          />
        ))}
      </div>

      {/* Summary stats */}
      {members.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <motion.div whileHover={{ scale: 1.05, y: -5 }} className="bg-linear-to-br from-white/7 to-white/2 backdrop-blur-2xl border-2 border-white/20 rounded-3xl p-8 hover:border-purple-500/50 transition-all duration-300">
            <div className="text-5xl mb-3 font-bold bg-linear-to-r from-white to-gray-400 bg-clip-text text-transparent">{members.length}</div>
            <div className="text-gray-400 text-lg">{t("team:stats.total")}</div>
          </motion.div>
          <motion.div whileHover={{ scale: 1.05, y: -5 }} className="bg-linear-to-br from-green-900/30 to-emerald-900/30 border-2 border-green-500/50 rounded-3xl p-8 shadow-xl shadow-green-500/20 hover:border-green-500/70 transition-all duration-300">
            <div className="text-5xl text-green-400 mb-3 font-bold">{available.length}</div>
            <div className="text-gray-300 text-lg">{t("team:stats.available")}</div>
          </motion.div>
          <motion.div whileHover={{ scale: 1.05, y: -5 }} className="bg-linear-to-br from-red-900/30 to-orange-900/30 border-2 border-red-500/50 rounded-3xl p-8 shadow-xl shadow-red-500/20 hover:border-red-500/70 transition-all duration-300">
            <div className="text-5xl text-red-400 mb-3 font-bold">{overloaded.length}</div>
            <div className="text-gray-300 text-lg">{t("team:stats.overloaded")}</div>
          </motion.div>
          <motion.div whileHover={{ scale: 1.05, y: -5 }} className="bg-linear-to-br from-purple-900/30 to-purple-900/10 border-2 border-purple-500/50 rounded-3xl p-8 shadow-xl shadow-purple-500/20 hover:border-purple-500/70 transition-all duration-300">
            <div className="text-5xl text-purple-400 mb-3 font-bold">{totalCompleted}</div>
            <div className="text-gray-300 text-lg">{t("team:stats.done")}</div>
          </motion.div>
        </div>
      )}


      <AnimatePresence>
        {confirmMember && (
          <ConfirmDeleteModal
            memberName={confirmMember.name}
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
