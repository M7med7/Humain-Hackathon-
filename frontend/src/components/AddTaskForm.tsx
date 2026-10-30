import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, X, Loader2 } from "lucide-react";
import { api, type Task, type ProjectMember } from "../lib/api";
import { useTranslation } from "react-i18next";

interface Props {
  projectId: string;
  members: ProjectMember[];
  currentUserId?: string | null;
  onCreated: (task: Task) => void;
}

export function AddTaskForm({ projectId, members, currentUserId, onCreated }: Props) {
  const { t } = useTranslation("tasks");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", priority: "Medium", assigned_to: "", estimated_days: "", tech: "",
  });

  const canSubmit = form.title.trim().length > 0 && Number(form.estimated_days) >= 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const techArray = form.tech.split(",").map(t => t.trim()).filter(Boolean);
      const { task } = await api.tasks.create({
        project_id: projectId,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        priority: form.priority,
        assigned_to: form.assigned_to || null,
        estimated_days: Math.max(1, Math.round(Number(form.estimated_days))),
        assigned_tech: techArray,
        user_id: currentUserId ?? null,
      });
      onCreated(task);
      setForm({ title: "", description: "", priority: "Medium", assigned_to: "", estimated_days: "", tech: "" });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally { setSaving(false); }
  };

  const inputCls = "w-full rounded-lg border border-white/15 app-input px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-purple-400/70 transition-colors";

  return (
    <div>
      {!open && (
        <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-xl border border-purple-500/40 bg-purple-900/30 px-4 py-2.5 text-sm font-semibold text-white hover:border-purple-400/70 hover:bg-purple-800/40 transition-all">
          <Plus className="h-4 w-4" /> {t("detail.addTask.action")}
        </motion.button>
      )}

      <AnimatePresence>
        {open && (
          <motion.form
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            onSubmit={handleSubmit}
            className="mt-3 rounded-xl border border-purple-500/30 app-input p-4 space-y-3 overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">{t("detail.addTask.title")}</span>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && <div className="p-2 text-xs text-red-300 bg-red-900/30 rounded-lg border border-red-500/30">{error}</div>}

            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder={t("detail.addTask.titlePlaceholder")} required className={inputCls} />

            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder={t("detail.addTask.descriptionPlaceholder")} rows={2} className={`${inputCls} resize-none`} />

            <div className="grid grid-cols-2 gap-3">
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className={inputCls}>
                <option value="High">🔴 {t("priority.high")}</option><option value="Medium">🟡 {t("priority.medium")}</option><option value="Low">🟢 {t("priority.low")}</option>
              </select>

              <input type="number" min="1" value={form.estimated_days}
                onChange={e => setForm(f => ({ ...f, estimated_days: e.target.value }))}
                placeholder={t("detail.addTask.daysPlaceholder")} required className={inputCls} />
            </div>

            <select value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
              className={inputCls}>
              <option value="">{t("detail.unassigned")}</option>
              {members.map(m => (
                <option key={m.user_id} value={m.user_id}>{m.full_name ?? m.email}</option>
              ))}
            </select>

            <input value={form.tech} onChange={e => setForm(f => ({ ...f, tech: e.target.value }))}
              placeholder={t("detail.addTask.techPlaceholder")} className={inputCls} />

            <motion.button type="submit" disabled={!canSubmit || saving}
              whileHover={canSubmit ? { y: -1 } : {}} whileTap={canSubmit ? { scale: 0.97 } : {}}
              className="w-full py-2.5 rounded-lg bg-linear-to-r from-purple-600 to-purple-900 text-sm font-semibold text-white disabled:opacity-40 transition-all">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t("detail.addTask.create")}
            </motion.button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
