import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { api, type ProfileData } from "../lib/api";
import { computeLevelInfo, getInitials } from "../lib/teamUtils";
import { useAuth } from "../contexts/AuthContext";
import { useTranslation } from "react-i18next";
import { SkillsSection, type SkillLevel } from "../components/SkillsSection";
import {
  Camera, Flame, Award,
  Edit2, Check, FileText, TrendingUp, Briefcase,
  Sparkles, RefreshCw, CheckCircle2, Eye, EyeOff, Globe,
} from "lucide-react";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

// ─── Extended local data (localStorage) ──────────────────────────────────────

interface ExtendedProfile {
  preferred_tech: string[];
  avoided_tech: string[];
  availability_days: number;
  daily_hours: number;
  skill_levels: Record<string, SkillLevel>;
  portfolio_url: string;
  cv_verified_skills: string[];
  ai_skill_summary: string;
  privacy: Record<string, boolean>;
}

const DEFAULT_PRIVACY: Record<string, boolean> = {
  show_skills: true,
  show_availability: true,
  show_completed_tasks: true,
  show_summary: true,
  show_social_links: true,
};

const DEFAULT_EXT: ExtendedProfile = {
  preferred_tech: [],
  avoided_tech: [],
  availability_days: 5,
  daily_hours: 8,
  skill_levels: {},
  portfolio_url: "",
  cv_verified_skills: [],
  ai_skill_summary: "",
  privacy: DEFAULT_PRIVACY,
};

function extKey(userId: string) { return `profile-ext-${userId}`; }

function loadExt(userId: string): ExtendedProfile {
  try {
    const raw = localStorage.getItem(extKey(userId));
    return raw ? { ...DEFAULT_EXT, ...JSON.parse(raw) } : { ...DEFAULT_EXT };
  } catch {
    return { ...DEFAULT_EXT };
  }
}

function saveExt(userId: string, data: ExtendedProfile) {
  localStorage.setItem(extKey(userId), JSON.stringify(data));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Component ────────────────────────────────────────────────────────────────

export function Profile() {
  const { session } = useAuth();
  const { t, i18n } = useTranslation("common");
  const currentUserId = session?.user.id;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [ext, setExt] = useState<ExtendedProfile>(DEFAULT_EXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode flags
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [editingSocials, setEditingSocials] = useState(false);
  const [socialsDraft, setSocialsDraft] = useState({ github: "", linkedin: "", x: "", portfolio: "" });
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  // Async states
  const [generatingAI, setGeneratingAI] = useState(false);
  const [savingSkills, setSavingSkills] = useState(false);

  useEffect(() => {
    if (!currentUserId) return;
    const extended = loadExt(currentUserId);
    // Local persisted profile data is an external store synchronized here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExt(extended);

    api.users
      .getProfile(currentUserId)
      .then(({ profile }) => {
        setProfile(profile);
        setSummaryDraft(profile.experience_summary ?? "");
        setTitleDraft(profile.job_title ?? "");
        setSocialsDraft({
          github: profile.github_url ?? "",
          linkedin: profile.linkedin_url ?? "",
          x: profile.x_url ?? "",
          portfolio: extended.portfolio_url,
        });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [currentUserId]);

  function patchExt(patch: Partial<ExtendedProfile>) {
    setExt((prev) => {
      const next = { ...prev, ...patch };
      if (currentUserId) saveExt(currentUserId, next);
      return next;
    });
  }

  // ── Save handlers ────────────────────────────────────────────────────────

  const saveTitle = async () => {
    if (!currentUserId || !profile) return;
    await api.users.update(currentUserId, { job_title: titleDraft });
    setProfile({ ...profile, job_title: titleDraft });
    setEditingTitle(false);
  };

  const saveSummary = async () => {
    if (!currentUserId || !profile) return;
    await api.users.update(currentUserId, { experience_summary: summaryDraft });
    setProfile({ ...profile, experience_summary: summaryDraft });
    setEditingSummary(false);
  };

  const saveSocials = async () => {
    if (!currentUserId || !profile) return;
    await api.users.update(currentUserId, {
      github_url: socialsDraft.github,
      linkedin_url: socialsDraft.linkedin,
      x_url: socialsDraft.x,
    });
    patchExt({ portfolio_url: socialsDraft.portfolio });
    setProfile({ ...profile, github_url: socialsDraft.github, linkedin_url: socialsDraft.linkedin, x_url: socialsDraft.x });
    setEditingSocials(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUserId || !profile) return;
    const res = await api.users.uploadAvatar(currentUserId, file);
    if (res.success) {
      setProfile({ ...profile, avatar_url: res.avatar_url });
      window.dispatchEvent(new Event("userProfileUpdated"));
    }
  };

  const handleUploadCV = async (file: File) => {
    if (!currentUserId || !profile) return;
    const res = await api.users.uploadCV(currentUserId, file);
    if (res.success) {
      patchExt({ cv_verified_skills: res.skills });
      setProfile({ ...profile, skills: res.skills, experience_summary: res.experience_summary, cv_parsed_at: new Date().toISOString() });
      setSummaryDraft(res.experience_summary);
    }
  };

  const handleSkillsChange = async (newSkills: string[]) => {
    if (!currentUserId || !profile) return;
    setSavingSkills(true);
    try {
      await api.users.update(currentUserId, { skills: newSkills });
      setProfile({ ...profile, skills: newSkills });
    } finally {
      setSavingSkills(false);
    }
  };

  const handleSkillLevelChange = (skill: string, level: SkillLevel | null) => {
    const updated = { ...ext.skill_levels };
    if (level) updated[skill] = level; else delete updated[skill];
    patchExt({ skill_levels: updated });
  };

  const handleGenerateAISummary = async () => {
    if (!profile) return;
    setGeneratingAI(true);
    try {
      const skillsText = profile.skills
        .map((s) => {
          const l = ext.skill_levels[s];
          return l ? `${s} (${l})` : s;
        })
        .join(", ");
      const recent = profile.completed_tasks.slice(0, 5).map((t) => t.title).join(", ");
      const { response } = await api.ai.chat({
        message: `Write a concise 2-3 sentence technical profile for team planning. Be specific and practical. Respond in ${i18n.language === "ar" ? "Arabic" : "English"}.
Skills: ${skillsText || "Not specified"}
Preferred tech: ${ext.preferred_tech.join(", ") || "None stated"}
Background: ${profile.experience_summary || "Not provided"}
Recent work: ${recent || "No completed tasks"}
Output only the profile text, no headers or labels.`,
      });
      patchExt({ ai_skill_summary: response });
    } finally {
      setGeneratingAI(false);
    }
  };

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-purple-400">
        <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="p-12 text-red-400">
        <p>{t("profile.page.loadFailed")}: {error ?? t("profile.page.notFound")}</p>
      </div>
    );
  }

  const initials = getInitials(profile.full_name, profile.email);
  const { level, progress: levelProgress } = computeLevelInfo(profile.completed_count);

  return (
    <div className="p-8 lg:p-12 max-w-7xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex flex-col lg:flex-row items-center lg:items-end gap-6 bg-linear-to-br from-white/5 to-white/2 backdrop-blur-3xl border border-white/10 rounded-3xl p-8"
      >
        <div className="relative group shrink-0">
          <div className="w-32 h-32 md:w-40 md:h-40 rounded-3xl bg-linear-to-br from-purple-600 to-indigo-800 shadow-2xl shadow-purple-500/30 flex items-center justify-center overflow-hidden border-4 border-white/5">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-5xl md:text-6xl text-white font-bold">{initials}</span>
            )}
            <div
              className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="w-8 h-8 text-white" />
            </div>
          </div>
          <input type="file" className="hidden" ref={fileInputRef} accept="image/*" onChange={handleAvatarUpload} />
        </div>

        <div className="min-w-0 flex-1 text-center lg:text-start">
          <h1 className="text-4xl font-bold text-white mb-2">{profile.full_name || profile.email}</h1>
          <div className="flex items-center justify-center lg:justify-start gap-2 mb-3">
            <Briefcase className="w-5 h-5 text-purple-400" />
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveTitle()}
                  placeholder={t("profile.page.rolePlaceholder")}
                  className="bg-black/40 border border-purple-500/50 rounded-lg px-3 py-1 text-sm text-white focus:outline-none"
                  autoFocus
                />
                <button onClick={saveTitle} className="text-purple-400 hover:text-white">
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="group flex items-center gap-2 cursor-pointer" onClick={() => setEditingTitle(true)}>
                <span className="text-purple-300 text-lg">{profile.job_title || t("profile.page.addRole")}</span>
                <Edit2 className="w-4 h-4 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 text-sm text-gray-400">
            <span>{profile.email}</span>
            {profile.phone && <><span className="text-gray-600">·</span><span>{profile.phone}</span></>}
          </div>
        </div>

        <label className="cursor-pointer inline-flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/30 transition-all shrink-0">
          <FileText className="w-4 h-4" />
          {profile.cv_parsed_at ? t("profile.page.updateCv") : t("profile.page.uploadCv")}
          <input type="file" className="hidden" accept=".pdf,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadCV(f); e.target.value = ""; }} />
        </label>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* ── Left column ──────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-8">

          {/* AI Technical Profile */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-linear-to-br from-purple-900/20 to-purple-950/10 border border-purple-500/20 rounded-3xl p-7"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <h2 className="text-xl font-bold text-white">{t("profile.page.aiProfile")}</h2>
              </div>
              <button
                onClick={handleGenerateAISummary}
                disabled={generatingAI}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-900/40 border border-purple-500/30 text-sm text-purple-300 hover:bg-purple-800/60 transition-all disabled:opacity-50"
              >
                {generatingAI
                  ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t("profile.page.generating")}</>
                  : <><Sparkles className="w-3.5 h-3.5" /> {ext.ai_skill_summary ? t("profile.page.regenerate") : t("profile.page.generate")}</>
                }
              </button>
            </div>
            {ext.ai_skill_summary ? (
              <p className="text-gray-300 leading-relaxed">{ext.ai_skill_summary}</p>
            ) : (
              <p className="text-sm text-gray-500 italic">
                {t("profile.page.aiProfileHelp")}
              </p>
            )}
          </motion.div>

          {/* About / Summary */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-linear-to-br from-white/5 to-white/2 backdrop-blur-2xl border border-white/10 rounded-3xl p-7"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">{t("profile.page.about")}</h2>
              {!editingSummary && (
                <button onClick={() => setEditingSummary(true)} className="text-gray-400 hover:text-white transition-colors">
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
            </div>
            {editingSummary ? (
              <div className="space-y-4">
                <textarea
                  value={summaryDraft}
                  onChange={(e) => setSummaryDraft(e.target.value)}
                  className="w-full bg-black/40 border border-purple-500/30 rounded-xl p-4 text-gray-200 outline-none focus:border-purple-500 min-h-[100px] resize-none"
                  placeholder={t("profile.page.aboutPlaceholder")}
                />
                <div className="flex justify-end gap-3">
                  <button onClick={() => { setEditingSummary(false); setSummaryDraft(profile.experience_summary ?? ""); }} className="px-4 py-2 text-sm text-gray-400 hover:text-white">{t("actions.cancel")}</button>
                  <button onClick={saveSummary} className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg flex items-center gap-2"><Check className="w-4 h-4" /> {t("actions.save")}</button>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 leading-relaxed">
                {profile.experience_summary || t("profile.page.noSummary")}
              </p>
            )}
          </motion.div>

          {/* Skills + Preferred + Avoided */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-linear-to-br from-white/5 to-white/2 backdrop-blur-2xl border border-white/10 rounded-3xl p-7"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-white">{t("profile.page.skills")}</h2>
              {savingSkills && <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />}
            </div>
            <SkillsSection
              skills={profile.skills}
              cvVerifiedSkills={ext.cv_verified_skills}
              skillLevels={ext.skill_levels}
              preferredTech={ext.preferred_tech}
              avoidedTech={ext.avoided_tech}
              onSkillsChange={handleSkillsChange}
              onSkillLevelChange={handleSkillLevelChange}
              onPreferredTechChange={(tech) => patchExt({ preferred_tech: tech })}
              onAvoidedTechChange={(tech) => patchExt({ avoided_tech: tech })}
            />
          </motion.div>

          {/* Recent completed tasks */}
          {profile.completed_tasks.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-linear-to-br from-white/5 to-white/2 backdrop-blur-2xl border border-white/10 rounded-3xl p-7"
            >
              <h2 className="text-xl font-bold text-white mb-5">{t("profile.page.recentTasks")}</h2>
              <div className="space-y-2">
                {profile.completed_tasks.slice(0, 8).map((t) => (
                  <div key={t.id} className="flex items-start gap-3 px-4 py-3 bg-green-900/10 rounded-xl border border-green-500/15">
                    <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-gray-200 truncate">{t.title}</div>
                      {t.project_name && (
                        <div className="text-xs text-gray-500 truncate mt-0.5">{t.project_name}</div>
                      )}
                    </div>
                  </div>
                ))}
                {profile.completed_tasks.length > 8 && (
                  <p className="text-xs text-gray-600 text-center pt-1">
                    {t("profile.page.moreCompleted", { count: profile.completed_tasks.length - 8 })}
                  </p>
                )}
              </div>
            </motion.div>
          )}

          {/* Level */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-linear-to-br from-purple-900/30 to-purple-950/10 border border-purple-500/20 rounded-3xl p-7 flex items-center gap-8"
          >
            <div className="w-20 h-20 rounded-full bg-linear-to-br from-purple-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/20 border-4 border-white/10">
              <TrendingUp className="w-9 h-9 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-end mb-2">
                <div>
                  <span className="text-gray-400 text-sm font-semibold uppercase tracking-wider">{t("profile.page.level")}</span>
                  <div className="text-3xl font-bold text-white">{level}</div>
                </div>
                <div className="text-sm text-purple-400 font-semibold">{t("profile.page.taskProgress", { completed: profile.completed_count, total: level * 5 })}</div>
              </div>
              <div className="h-3 bg-black/50 rounded-full overflow-hidden border border-white/5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${levelProgress}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className="h-full bg-linear-to-r from-purple-500 to-indigo-400"
                />
              </div>
            </div>
          </motion.div>

          {/* Achievements */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-linear-to-br from-white/5 to-white/2 backdrop-blur-2xl border border-white/10 rounded-3xl p-7"
          >
            <h2 className="text-xl font-bold text-white mb-5">{t("profile.page.achievements")}</h2>
            {profile.achievements.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {profile.achievements.map((a, i) => (
                  <div key={i} className="flex items-center gap-4 bg-purple-900/20 border border-purple-500/20 rounded-2xl p-4">
                    <div className="w-9 h-9 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                      <Award className="w-4 h-4 text-purple-400" />
                    </div>
                    <span className="text-gray-200 font-medium text-sm">{a}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic text-center p-5 bg-black/20 rounded-2xl border border-white/5">
                {t("profile.page.noAchievements")}
              </p>
            )}
          </motion.div>
        </div>

        {/* ── Right sidebar ─────────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Availability */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-linear-to-br from-white/5 to-white/2 backdrop-blur-2xl border border-white/10 rounded-3xl p-6"
          >
            <h3 className="text-lg font-bold text-white mb-4">{t("profile.page.availability")}</h3>
            <p className="text-xs text-gray-500 mb-4">{t("profile.page.availabilityHelp")}</p>

            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-400 mb-2 block">{t("profile.page.daysPerWeek")}</label>
              <div className="flex gap-2">
                {["M", "T", "W", "T", "F"].map((day, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => patchExt({ availability_days: i + 1 })}
                    className={`w-9 h-9 rounded-lg text-xs font-semibold border transition-all ${
                      i < ext.availability_days
                        ? "border-purple-500/60 bg-purple-900/40 text-purple-200"
                        : "border-white/10 bg-white/3 text-gray-600 hover:border-white/20"
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">{t("profile.page.daysWeek", { count: ext.availability_days })}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-400 mb-2 block">{t("profile.page.dailyCapacity")}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1" max="12"
                  value={ext.daily_hours}
                  onChange={(e) => patchExt({ daily_hours: parseInt(e.target.value, 10) })}
                  className="flex-1 accent-purple-500"
                />
                <span className="text-sm font-semibold text-white w-12 text-right">{ext.daily_hours}h</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {t("profile.page.weeklyHours", { count: ext.availability_days * ext.daily_hours })}
              </p>
            </div>
          </motion.div>

          {/* Socials + Portfolio */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-linear-to-br from-white/5 to-white/2 backdrop-blur-2xl border border-white/10 rounded-3xl p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-white">{t("profile.page.links")}</h3>
              {!editingSocials && (
                <button onClick={() => setEditingSocials(true)} className="text-gray-400 hover:text-white transition-colors">
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {editingSocials ? (
              <div className="space-y-3">
                {[
                  { icon: GithubIcon, key: "github" as const, placeholder: "GitHub URL" },
                  { icon: LinkedinIcon, key: "linkedin" as const, placeholder: "LinkedIn URL" },
                  { icon: TwitterIcon, key: "x" as const, placeholder: "X / Twitter URL" },
                  { icon: Globe, key: "portfolio" as const, placeholder: t("profile.page.portfolioUrl") },
                ].map(({ icon: Icon, key, placeholder }) => (
                  <div key={key} className="relative">
                    <Icon className="w-4 h-4 absolute left-3 top-3 text-gray-500" />
                    <input
                      type="text"
                      value={socialsDraft[key]}
                      onChange={(e) => setSocialsDraft({ ...socialsDraft, [key]: e.target.value })}
                      placeholder={placeholder}
                      className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white focus:border-purple-500 outline-none"
                    />
                  </div>
                ))}
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setEditingSocials(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">{t("actions.cancel")}</button>
                  <button onClick={saveSocials} className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded-md">{t("actions.save")}</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { icon: GithubIcon, url: profile.github_url, label: "GitHub" },
                  { icon: LinkedinIcon, url: profile.linkedin_url, label: "LinkedIn" },
                  { icon: TwitterIcon, url: profile.x_url, label: "X / Twitter" },
                  { icon: Globe, url: ext.portfolio_url, label: t("profile.page.portfolio") },
                ].map(({ icon: Icon, url, label }) =>
                  url ? (
                    <a
                      key={label}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/3 border border-white/8 hover:bg-white/8 transition-colors text-sm text-gray-300 hover:text-white"
                    >
                      <Icon className="w-4 h-4 text-gray-500 shrink-0" />
                      {label}
                    </a>
                  ) : null
                )}
                {!profile.github_url && !profile.linkedin_url && !profile.x_url && !ext.portfolio_url && (
                  <span className="text-sm text-gray-500 italic">{t("profile.page.noLinks")}</span>
                )}
              </div>
            )}
          </motion.div>

          {/* Privacy controls */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-linear-to-br from-white/5 to-white/2 backdrop-blur-2xl border border-white/10 rounded-3xl p-6"
          >
            <h3 className="text-lg font-bold text-white mb-1">{t("profile.page.privacy")}</h3>
            <p className="text-xs text-gray-500 mb-4">{t("profile.page.privacyHelp")}</p>
            <div className="space-y-3">
              {Object.keys(DEFAULT_PRIVACY).map((key) => {
                const visible = ext.privacy[key] ?? true;
                return (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">{t(`profile.page.privacyLabels.${key}`)}</span>
                    <button
                      type="button"
                      onClick={() => patchExt({ privacy: { ...ext.privacy, [key]: !visible } })}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                        visible
                          ? "border-emerald-500/30 bg-emerald-900/20 text-emerald-400"
                          : "border-white/10 bg-white/3 text-gray-500"
                      }`}
                    >
                      {visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      {visible ? t("profile.page.visible") : t("profile.page.hidden")}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Weekly Streak */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-linear-to-br from-orange-900/20 to-orange-950/10 border border-orange-500/20 rounded-3xl p-6 relative overflow-hidden"
          >
            <div className="absolute -right-4 -top-4 opacity-10">
              <Flame className="w-32 h-32 text-orange-500" />
            </div>
            <h3 className="text-lg font-bold text-white mb-5 relative z-10">{t("profile.page.weeklyStreak")}</h3>
            <div className="flex items-center gap-4 relative z-10">
              <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
                <Flame className={`w-6 h-6 ${profile.weekly_streak > 0 ? "text-orange-500" : "text-gray-600"}`} />
              </div>
              <div className="text-3xl font-bold text-white">
                {profile.weekly_streak} <span className="text-base text-gray-400 font-normal">{t("profile.page.weeks")}</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
