import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Loader2, Sparkles, Users } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  api,
  computeTaskDiff,
  type ConversationMessage,
  type GeneratedTask,
  type PlanPreviewResult,
  type ProjectTemplate,
  type RefinementResult,
  type TaskDiff,
  type User,
} from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { mapLocalTeamMemberToUser, readLocalTeamMembers } from "../lib/localTeamMembers";
import { PlanQualityReview } from "../components/PlanQualityReview";
import { AdvancedProjectOptions } from "../components/AdvancedProjectOptions";
import { useTranslation } from "react-i18next";

type Step = "form" | "reviewing";

export function CreateProject() {
  const { t } = useTranslation("projects");
  const navigate = useNavigate();
  const { session } = useAuth();
  const uid = useId();

  // ── Wizard step ──────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("form");
  const [preview, setPreview] = useState<PlanPreviewResult | null>(null);

  // ── Loading flags ────────────────────────────────────────────────────────────
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImproving, setIsImproving] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefining, setIsRefining] = useState(false);

  // ── Error ────────────────────────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);

  // ── Form fields ──────────────────────────────────────────────────────────────
  const [expandDescription, setExpandDescription] = useState(true);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("blank");
  const [duplicatingTemplateId, setDuplicatingTemplateId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "", duration: "", duration_unit: "Weeks" });
  const [users, setUsers] = useState<User[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  // ── Advanced options ─────────────────────────────────────────────────────────
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [complexity, setComplexity] = useState<'simple' | 'standard' | 'advanced'>('standard');
  const [budget, setBudget] = useState('');
  const [deadlineStrictness, setDeadlineStrictness] = useState<'flexible' | 'fixed'>('flexible');
  const [preferredTech, setPreferredTech] = useState<string[]>([]);
  const [excludedTech, setExcludedTech] = useState<string[]>([]);
  const [preferredTechInput, setPreferredTechInput] = useState('');
  const [excludedTechInput, setExcludedTechInput] = useState('');

  // ── Refinement state ─────────────────────────────────────────────────────────
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [pendingRefinement, setPendingRefinement] = useState<RefinementResult | null>(null);
  const [pendingDiff, setPendingDiff] = useState<TaskDiff | null>(null);
  const [keepManualEdits, setKeepManualEdits] = useState(true);

  // ── Manual edits: Map<taskId, edited GeneratedTask> ──────────────────────────
  const [manuallyEditedTasks, setManuallyEditedTasks] = useState<Map<string, GeneratedTask>>(new Map());
  const [assigneeOverrides, setAssigneeOverrides] = useState<Set<string>>(new Set());

  const manuallyEditedTaskIds = new Set(manuallyEditedTasks.keys());

  // ── Member name lookup ───────────────────────────────────────────────────────
  const memberNames = new Map<string, string>(
    users.map((u) => [u.id, u.full_name ?? u.email]),
  );

  // ── Data loading ─────────────────────────────────────────────────────────────
  useEffect(() => {
    api.users
      .list()
      .then(({ users: fetched }) => {
        const localUsers = readLocalTeamMembers().map(mapLocalTeamMemberToUser);
        const existingIds = new Set(fetched.map((u) => u.id));
        setUsers([...fetched, ...localUsers.filter((u) => !existingIds.has(u.id))]);
      })
      .catch(() => setUsers(readLocalTeamMembers().map(mapLocalTeamMemberToUser)));
  }, []);

  useEffect(() => {
    api.templates
      .list()
      .then(({ templates: fetched }) => setTemplates(fetched))
      .catch(() => {
        setTemplates([{
          id: "blank", name: "Blank Project",
          description: "Start from your own description without template guidance.",
          category: "Blank", phases: [], recommended_technologies: [], is_custom: false,
        }]);
      });
  }, []);

  // ── Form submit → generate + quality check ───────────────────────────────────
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selectedMembers.length === 0) {
      setError("Select at least one team member before generating the project plan");
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const result = await api.ai.generate({
        ...formData,
        team_members: selectedMembers,
        expand_description: expandDescription,
        template_id: selectedTemplateId,
        complexity,
        ...(budget.trim() && !isNaN(Number(budget)) && { budget: Number(budget) }),
        deadline_strictness: deadlineStrictness,
        ...(preferredTech.length > 0 && { preferred_tech: preferredTech }),
        ...(excludedTech.length > 0 && { excluded_tech: excludedTech }),
      });
      if (result.offline) { navigate("/"); return; }
      setPreview(result);
      setConversationMessages([]);
      setManuallyEditedTasks(new Map());
      setAssigneeOverrides(new Set());
      setPendingRefinement(null);
      setPendingDiff(null);
      setStep("reviewing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate project plan");
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Accept → save and navigate ───────────────────────────────────────────────
  const handleAccept = async () => {
    if (!preview) return;
    setIsSaving(true);
    setError(null);
    try {
      const { project_id } = await api.ai.save({
        projectId: preview.projectId,
        schedule: preview.schedule,
        name: formData.name,
        savedDescription: preview.savedDescription,
        durationWeeks: preview.durationWeeks,
        databaseMembers: preview.databaseMembers,
      });
      navigate(`/projects/${project_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save project");
      setIsSaving(false);
    }
  };

  // ── Improve via quality checker (batch-fix all issues) ───────────────────────
  const handleImprove = async () => {
    if (!preview) return;
    setIsImproving(true);
    setError(null);
    try {
      const result = await api.ai.improve({
        currentSchedule: preview.schedule,
        issues: preview.qualityReport.issues,
        name: formData.name,
        description: formData.description,
        duration: formData.duration,
        duration_unit: formData.duration_unit,
        team_members: selectedMembers,
        databaseMembers: preview.databaseMembers,
        totalDays: preview.totalDays,
      });
      setPreview(result);
      setManuallyEditedTasks(new Map());
      setAssigneeOverrides(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to improve plan");
    } finally {
      setIsImproving(false);
    }
  };

  // ── Refinement chat → compute diff → show preview modal ─────────────────────
  const handleSendRefinement = async (message: string) => {
    if (!preview || isRefining) return;
    setIsRefining(true);
    setError(null);

    const userMsg: ConversationMessage = {
      id: `${uid}-u-${Date.now()}`,
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };
    setConversationMessages((prev) => [...prev, userMsg]);

    try {
      const result = await api.ai.refine({
        currentSchedule: preview.schedule,
        userMessage: message,
        conversationHistory: conversationMessages
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.content })),
        name: formData.name,
        description: formData.description,
        duration: formData.duration,
        duration_unit: formData.duration_unit,
        team_members: selectedMembers,
        databaseMembers: preview.databaseMembers,
        totalDays: preview.totalDays,
      });

      const diff = computeTaskDiff(preview.schedule, result.schedule);

      const aiMsg: ConversationMessage = {
        id: `${uid}-a-${Date.now()}`,
        role: "assistant",
        content: result.refinementSummary,
        timestamp: new Date().toISOString(),
        scheduleSnapshot: result.schedule,
      };
      setConversationMessages((prev) => [...prev, aiMsg]);

      setPendingRefinement(result);
      setPendingDiff(diff);
    } catch (err) {
      const errMsg: ConversationMessage = {
        id: `${uid}-e-${Date.now()}`,
        role: "assistant",
        content: err instanceof Error ? err.message : "Something went wrong. Please try again.",
        timestamp: new Date().toISOString(),
      };
      setConversationMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsRefining(false);
    }
  };

  // ── Apply refinement (respecting manual-edit protection) ─────────────────────
  const handleApplyRefinement = () => {
    if (!pendingRefinement || !preview) return;

    let newSchedule = pendingRefinement.schedule;

    if (keepManualEdits && manuallyEditedTasks.size > 0) {
      // Re-apply manual edits on top of the AI result
      const newTasks = newSchedule.tasks.map((t) => manuallyEditedTasks.get(t.id) ?? t);
      // Re-add any manually edited tasks that AI removed
      const aiIds = new Set(newSchedule.tasks.map((t) => t.id));
      const restored = [...manuallyEditedTasks.values()].filter((t) => !aiIds.has(t.id));
      newSchedule = { ...newSchedule, tasks: [...newTasks, ...restored] };
    }

    setPreview({ ...pendingRefinement, schedule: newSchedule });
    setAssigneeOverrides((prev) => {
      if (!keepManualEdits) return new Set();
      const taskIds = new Set(newSchedule.tasks.map((task) => task.id));
      return new Set([...prev].filter((taskId) => taskIds.has(taskId)));
    });
    setPendingRefinement(null);
    setPendingDiff(null);
  };

  // ── Cancel refinement ─────────────────────────────────────────────────────────
  const handleCancelRefinement = () => {
    setPendingRefinement(null);
    setPendingDiff(null);
    // Remove the last assistant message (the pending one) from history
    setConversationMessages((prev) =>
      prev.length > 0 && prev[prev.length - 1]?.role === "assistant"
        ? prev.slice(0, -1)
        : prev,
    );
  };

  // ── Inline task edit ──────────────────────────────────────────────────────────
  const handleTaskEdit = (taskId: string, field: keyof GeneratedTask, value: string | number) => {
    if (!preview) return;
    const updatedTasks = preview.schedule.tasks.map((t) =>
      t.id === taskId ? { ...t, [field]: value } : t,
    );
    const updatedTask = updatedTasks.find((t) => t.id === taskId);
    if (updatedTask) {
      setManuallyEditedTasks((prev) => new Map(prev).set(taskId, updatedTask));
    }
    setPreview({ ...preview, schedule: { ...preview.schedule, tasks: updatedTasks } });
  };

  const handleAssigneeChange = (taskId: string, userId: string) => {
    if (!preview) return;
    const updatedTasks = preview.schedule.tasks.map((task) =>
      task.id === taskId ? { ...task, assigned_to: userId } : task,
    );
    const updatedTask = updatedTasks.find((task) => task.id === taskId);
    if (updatedTask) {
      setManuallyEditedTasks((prev) => new Map(prev).set(taskId, updatedTask));
    }
    setAssigneeOverrides((prev) => new Set(prev).add(taskId));
    setPreview({ ...preview, schedule: { ...preview.schedule, tasks: updatedTasks } });
  };

  // ── Misc helpers ──────────────────────────────────────────────────────────────
  const handleBack = () => { setStep("form"); setPreview(null); setError(null); };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });

  const toggleMember = (userId: string) =>
    setSelectedMembers((curr) =>
      curr.includes(userId) ? curr.filter((id) => id !== userId) : [...curr, userId],
    );

  const handleDuplicateTemplate = async (templateId: string) => {
    setDuplicatingTemplateId(templateId);
    setError(null);
    try {
      const { template } = await api.templates.duplicate(templateId, session?.user.id ?? null);
      setTemplates((curr) => [template, ...curr]);
      setSelectedTemplateId(template.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate template");
    } finally {
      setDuplicatingTemplateId(null);
    }
  };

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full px-4 py-6 sm:px-8 md:px-12 md:py-10 flex justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-5xl"
      >
        {/* Title */}
        <div className="mb-8 md:mb-12 flex items-center justify-between gap-6">
          <div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl mb-3 bg-linear-to-r from-white via-purple-100 to-purple-200 bg-clip-text text-transparent font-bold">
              {step === "reviewing" ? t("create.reviewTitle") : t("create.title")}
            </h2>
            <p className="text-gray-400 text-xl">
              {step === "reviewing"
                ? t("create.reviewSubtitle")
                : t("create.subtitle")}
            </p>
          </div>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-purple-400/30 bg-purple-900/30 shadow-lg shadow-purple-500/20">
            <Sparkles className="w-7 h-7 text-purple-200" />
          </div>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 p-4 bg-red-900/30 border border-red-500/50 rounded-xl text-red-300 text-sm"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step content */}
        <AnimatePresence mode="wait">
          {step === "reviewing" && preview ? (
            <motion.div key="reviewing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <PlanQualityReview
                projectName={formData.name}
                schedule={preview.schedule}
                qualityReport={preview.qualityReport}
                totalDays={preview.totalDays}
                memberNames={memberNames}
                conversationMessages={conversationMessages}
                pendingRefinement={pendingRefinement}
                pendingDiff={pendingDiff}
                manuallyEditedTaskIds={manuallyEditedTaskIds}
                assigneeOverrides={assigneeOverrides}
                recommendations={preview.recommendations ?? {}}
                isRefining={isRefining}
                isSaving={isSaving}
                isImproving={isImproving}
                keepManualEdits={keepManualEdits}
                onAccept={handleAccept}
                onImprove={handleImprove}
                onBack={handleBack}
                onSendRefinement={handleSendRefinement}
                onApplyRefinement={handleApplyRefinement}
                onCancelRefinement={handleCancelRefinement}
                onTaskEdit={handleTaskEdit}
                onAssigneeChange={handleAssigneeChange}
                onToggleKeepManualEdits={() => setKeepManualEdits((v) => !v)}
              />
            </motion.div>
          ) : (
            <motion.form
              key="form"
              onSubmit={handleSubmit}
              className="space-y-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Template selector */}
              <div>
                <div className="mb-3 flex items-center justify-between gap-4">
                  <label className="block text-lg text-gray-300 font-semibold">{t("create.template")}</label>
                  <span className="text-sm text-gray-500">{t("create.optional")}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {templates.map((template) => {
                    const isSelected = selectedTemplateId === template.id;
                    const canDuplicate = template.id !== "blank";
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(template.id)}
                        className={`group min-h-[150px] rounded-2xl border-2 p-4 text-left transition-all ${isSelected
                          ? "border-purple-500/70 bg-purple-900/25 shadow-lg shadow-purple-500/10"
                          : "border-white/10 app-surface-soft hover:border-white/25"
                          }`}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-white">{template.name}</div>
                            <div className="mt-1 text-xs text-purple-300">
                              {template.category}{template.is_custom ? " template" : ""}
                            </div>
                          </div>
                          {canDuplicate && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); handleDuplicateTemplate(template.id); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault(); e.stopPropagation();
                                  handleDuplicateTemplate(template.id);
                                }
                              }}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-gray-500 opacity-100 transition-colors hover:border-purple-500/40 hover:bg-purple-900/30 hover:text-purple-200 md:opacity-0 md:group-hover:opacity-100"
                              aria-label={`Duplicate ${template.name}`}
                              title={t("create.duplicate")}
                            >
                              {duplicatingTemplateId === template.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Copy className="h-3.5 w-3.5" />}
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-3 text-sm leading-5 text-gray-400">{template.description}</p>
                        {template.phases.length > 0 && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {template.phases.slice(0, 3).map((phase) => (
                              <span key={phase} className="rounded-md border border-white/10 app-surface-soft px-2 py-1 text-[11px] text-gray-400">
                                {phase}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                {selectedTemplate && selectedTemplate.recommended_technologies.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-400">
                    <span className="text-gray-500">{t("create.recommended")}</span>
                    {selectedTemplate.recommended_technologies.slice(0, 8).map((tech) => (
                      <span key={tech} className="rounded-full border border-purple-500/20 bg-purple-900/20 px-2.5 py-1 text-xs text-purple-200">
                        {tech}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Project name */}
              <div>
                <label className="block text-lg text-gray-300 mb-3 font-semibold">{t("create.name")}</label>
                <input
                  type="text" name="name" value={formData.name} onChange={handleChange} required
                  placeholder={t("create.namePlaceholder")}
                  className="w-full px-6 py-5 bg-linear-to-br from-white/10 to-white/5 border-2 border-white/20 rounded-2xl focus:outline-none focus:border-purple-500/70 focus:shadow-2xl focus:shadow-purple-500/30 text-white placeholder-gray-500 transition-all duration-300 hover:border-white/30 text-lg"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-lg text-gray-300 mb-3 font-semibold">
                  {t("create.description")}
                  <span className="ms-3 text-purple-400 font-normal">({t("create.analyze")})</span>
                </label>
                <textarea
                  name="description" value={formData.description} onChange={handleChange} required rows={5}
                  placeholder={t("create.descriptionPlaceholder")}
                  className="w-full px-6 py-5 bg-linear-to-br from-white/10 to-white/5 border-2 border-white/20 rounded-2xl focus:outline-none focus:border-purple-500/70 focus:shadow-2xl focus:shadow-purple-500/30 text-white placeholder-gray-500 transition-all duration-300 hover:border-white/30 resize-none text-lg leading-relaxed"
                />
                <label className="mt-4 flex items-start gap-3 cursor-pointer group">
                  <div className="relative mt-0.5 shrink-0">
                    <input type="checkbox" checked={expandDescription} onChange={(e) => setExpandDescription(e.target.checked)} className="sr-only peer" />
                    <div className="w-5 h-5 rounded border-2 border-white/20 app-surface-soft peer-checked:border-purple-500 peer-checked:bg-purple-600 transition-all flex items-center justify-center">
                      {expandDescription && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </div>
                  </div>
                  <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors leading-5">
                    <span className="text-white font-medium">{t("create.enhance")}</span> — {t("create.enhanceHelp")}
                  </span>
                </label>
                <div className="mt-3 flex items-center gap-3 text-sm text-gray-400">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span>{t("create.willGenerate")}</span>
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="block text-lg text-gray-300 mb-3 font-semibold">{t("create.duration")}</label>
                <div className="flex gap-4">
                  <input
                    type="number" name="duration" value={formData.duration} onChange={handleChange}
                    required min="1" placeholder="8"
                    className="w-full px-6 py-5 bg-linear-to-br from-white/10 to-white/5 border-2 border-white/20 rounded-2xl focus:outline-none focus:border-purple-500/70 text-white placeholder-gray-500 transition-all duration-300 hover:border-white/30 text-lg"
                  />
                  <select
                    name="duration_unit" value={formData.duration_unit} onChange={handleChange}
                    className="w-48 px-6 py-5 bg-linear-to-br from-white/10 to-white/5 border-2 border-white/20 rounded-2xl focus:outline-none focus:border-purple-500/70 text-white transition-all duration-300 hover:border-white/30 text-lg appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23FFFFFF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1.25rem center', backgroundSize: '1rem' }}
                  >
                    <option value="Weeks" className="bg-gray-900">{t("create.weeks")}</option>
                    <option value="Months" className="bg-gray-900">{t("create.months")}</option>
                    <option value="Years" className="bg-gray-900">{t("create.years")}</option>
                  </select>
                </div>
              </div>

              {/* Team members */}
              <div>
                <div className="flex items-center justify-between gap-4 mb-3">
                  <label className="block text-lg text-gray-300 font-semibold">{t("create.assign")}</label>
                  <span className="text-sm text-gray-500">{t("create.selected", { count: selectedMembers.length })}</span>
                </div>
                {users.length === 0 ? (
                  <div className="rounded-2xl border-2 border-white/10 app-surface-soft p-6 text-gray-500">
                    No team members found. Add people in the Team tab first.
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {users.map((user) => {
                      const isSelected = selectedMembers.includes(user.id);
                      const displayName = user.full_name ?? user.email;
                      return (
                        <button
                          key={user.id} type="button" onClick={() => toggleMember(user.id)}
                          className={`flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all ${isSelected ? "border-purple-500/70 bg-purple-900/25" : "border-white/10 app-surface-soft hover:border-white/25"
                            }`}
                        >
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-purple-600 to-purple-900 text-sm font-bold text-white">
                            {displayName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-white">{displayName}</div>
                            <div className="truncate text-sm text-gray-500">{user.email}</div>
                          </div>
                          <div className={`flex h-6 w-6 items-center justify-center rounded-full border ${isSelected ? "border-purple-400 bg-purple-500" : "border-white/20"}`}>
                            {isSelected && <Users className="h-3.5 w-3.5 text-white" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3 text-sm text-gray-400">
                  <Users className="w-4 h-4 text-purple-400" />
                  <span>{t("create.assignHelp")}</span>
                </div>
              </div>

              {/* Advanced options */}
              <AdvancedProjectOptions
                show={showAdvanced}
                onToggle={() => setShowAdvanced((v) => !v)}
                complexity={complexity}
                onComplexityChange={setComplexity}
                budget={budget}
                onBudgetChange={setBudget}
                deadlineStrictness={deadlineStrictness}
                onDeadlineStrictnessChange={setDeadlineStrictness}
                preferredTech={preferredTech}
                onPreferredTechChange={setPreferredTech}
                preferredTechInput={preferredTechInput}
                onPreferredTechInputChange={setPreferredTechInput}
                excludedTech={excludedTech}
                onExcludedTechChange={setExcludedTech}
                excludedTechInput={excludedTechInput}
                onExcludedTechInputChange={setExcludedTechInput}
              />

              {/* AI info card */}
              <motion.div
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                className="bg-linear-to-br from-purple-900/30 to-purple-950/10 border-2 border-purple-500/50 rounded-3xl p-5 sm:p-8 shadow-2xl shadow-purple-500/20 relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-linear-to-br from-purple-500/5 to-transparent animate-pulse" />
                <div className="flex items-start gap-6 relative z-10">
                  <div className="p-4 bg-linear-to-br from-purple-600 to-purple-900 rounded-2xl shadow-xl shadow-purple-500/50">
                    <Sparkles className="w-8 h-8 text-white" />
                  </div>
                  <div className="flex-1">
                    <h4 className="mb-3 text-2xl font-semibold bg-linear-to-r from-purple-300 to-white bg-clip-text text-transparent">{t("create.planning")}</h4>
                    <p className="text-base text-gray-300 leading-relaxed mb-5">{t("create.planningIntro")}</p>
                    <ul className="space-y-4 text-base text-gray-200">
                      {[
                        { color: "bg-purple-400 shadow-purple-400/50", text: t("create.timeline") },
                        { color: "bg-purple-400 shadow-purple-400/50", text: t("create.sprints") },
                        { color: "bg-green-400 shadow-green-400/50", text: t("create.cost") },
                        { color: "bg-yellow-400 shadow-yellow-400/50", text: t("create.feasibility") },
                      ].map((item, i) => (
                        <li key={i} className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${item.color} shadow-lg`} />
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </motion.div>

              {/* Submit */}
              <motion.button
                type="submit" disabled={isGenerating}
                whileHover={!isGenerating ? { y: -2 } : {}}
                whileTap={!isGenerating ? { scale: 0.98 } : {}}
                className={`w-full py-7 rounded-3xl text-xl font-bold transition-all duration-300 relative overflow-hidden border ${isGenerating ? "app-input border-white/5 cursor-not-allowed text-white/40" : "bg-purple-600 border-purple-500/40 text-white shadow-lg shadow-purple-500/20"
                  }`}
              >
                {!isGenerating && (
                  <motion.div
                    className="absolute inset-0 rounded-3xl pointer-events-none"
                    style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(124,58,237,0.34) 55%, rgba(255,255,255,0.16) 100%)" }}
                    initial={{ opacity: 0 }} whileHover={{ opacity: 1 }} transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                )}
                {isGenerating ? (
                  <span className="flex items-center justify-center gap-4 relative z-10">
                    <Loader2 className="w-7 h-7 animate-spin" /><span>{t("create.generating")}</span>
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-4 relative z-10">
                    <Sparkles className="w-7 h-7" /><span>{t("create.generate")}</span>
                  </span>
                )}
              </motion.button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Generation progress */}
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="mt-10 bg-linear-to-br from-white/5 to-white/2 border-2 border-purple-500/30 rounded-3xl p-5 sm:p-8 space-y-5"
          >
            {[
              { label: "Analyzing project requirements", delay: 0 },
              { label: "Generating timeline and milestones", delay: 0.8 },
              { label: "Creating sprint breakdown", delay: 1.6 },
              { label: "Running quality checks", delay: 2.4 },
            ].map((s, i) => (
              <motion.div
                key={i} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: s.delay }} className="flex items-center gap-4 text-lg text-gray-300"
              >
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full shrink-0"
                />
                <span>{s.label}</span>
              </motion.div>
            ))}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
