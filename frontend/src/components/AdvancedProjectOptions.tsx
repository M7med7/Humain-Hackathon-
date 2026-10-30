import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface AdvancedProjectOptionsProps {
  show: boolean;
  onToggle: () => void;
  complexity: 'simple' | 'standard' | 'advanced';
  onComplexityChange: (v: 'simple' | 'standard' | 'advanced') => void;
  budget: string;
  onBudgetChange: (v: string) => void;
  deadlineStrictness: 'flexible' | 'fixed';
  onDeadlineStrictnessChange: (v: 'flexible' | 'fixed') => void;
  preferredTech: string[];
  onPreferredTechChange: (tags: string[]) => void;
  preferredTechInput: string;
  onPreferredTechInputChange: (v: string) => void;
  excludedTech: string[];
  onExcludedTechChange: (tags: string[]) => void;
  excludedTechInput: string;
  onExcludedTechInputChange: (v: string) => void;
}

export function AdvancedProjectOptions({
  show, onToggle,
  complexity, onComplexityChange,
  budget, onBudgetChange,
  deadlineStrictness, onDeadlineStrictnessChange,
  preferredTech, onPreferredTechChange, preferredTechInput, onPreferredTechInputChange,
  excludedTech, onExcludedTechChange, excludedTechInput, onExcludedTechInputChange,
}: AdvancedProjectOptionsProps) {
  const { t } = useTranslation("projects");
  const addPreferredTag = () => {
    const tag = preferredTechInput.trim().replace(/,$/, "");
    if (tag && !preferredTech.includes(tag)) onPreferredTechChange([...preferredTech, tag]);
    onPreferredTechInputChange("");
  };

  const addExcludedTag = () => {
    const tag = excludedTechInput.trim().replace(/,$/, "");
    if (tag && !excludedTech.includes(tag)) onExcludedTechChange([...excludedTech, tag]);
    onExcludedTechInputChange("");
  };

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        <span className="text-base font-semibold text-gray-300">{t("create.advanced.title")}</span>
        <span className="text-xs text-gray-600 border border-white/10 rounded px-1.5 py-0.5">{t("create.optional")}</span>
        <svg className={`w-4 h-4 transition-transform ${show ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mt-5 space-y-6 rounded-2xl border border-white/10 bg-white/3 p-6">

              {/* Complexity */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-3">{t("create.advanced.complexity")}</label>
                <div className="grid grid-cols-3 gap-3">
                  {(["simple", "standard", "advanced"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => onComplexityChange(level)}
                      className={`rounded-xl border-2 px-4 py-3 text-sm font-medium capitalize transition-all ${
                        complexity === level
                          ? "border-purple-500/70 bg-purple-900/25 text-white"
                          : "border-white/10 bg-white/3 text-gray-400 hover:border-white/25 hover:text-gray-300"
                      }`}
                    >
                      {t(`create.advanced.levels.${level}`)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {complexity === "simple"
                    ? t("create.advanced.complexityHelp.simple")
                    : complexity === "advanced"
                    ? t("create.advanced.complexityHelp.advanced")
                    : t("create.advanced.complexityHelp.standard")}
                </p>
              </div>

              {/* Budget */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">{t("create.advanced.budget")}</label>
                <input
                  type="number" min="0" placeholder={t("create.advanced.budgetPlaceholder")}
                  value={budget} onChange={(e) => onBudgetChange(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/15 rounded-xl focus:outline-none focus:border-purple-500/60 text-white placeholder-gray-600 transition-colors text-sm"
                />
                <p className="mt-1.5 text-xs text-gray-500">{t("create.advanced.budgetHelp")}</p>
              </div>

              {/* Deadline strictness */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-3">{t("create.advanced.deadline")}</label>
                <div className="flex gap-3">
                  {(["flexible", "fixed"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => onDeadlineStrictnessChange(opt)}
                      className={`flex-1 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                        deadlineStrictness === opt
                          ? "border-purple-500/70 bg-purple-900/25 text-white"
                          : "border-white/10 bg-white/3 text-gray-400 hover:border-white/25 hover:text-gray-300"
                      }`}
                    >
                      {t(`create.advanced.deadlines.${opt}`)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {deadlineStrictness === "fixed"
                    ? t("create.advanced.deadlineHelp.fixed")
                    : t("create.advanced.deadlineHelp.flexible")}
                </p>
              </div>

              {/* Preferred tech */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">{t("create.advanced.preferred")}</label>
                <input
                  type="text" placeholder={t("create.advanced.preferredPlaceholder")}
                  value={preferredTechInput} onChange={(e) => onPreferredTechInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === ",") && preferredTechInput.trim()) {
                      e.preventDefault();
                      addPreferredTag();
                    }
                  }}
                  className="w-full px-4 py-3 bg-white/5 border border-white/15 rounded-xl focus:outline-none focus:border-purple-500/60 text-white placeholder-gray-600 transition-colors text-sm"
                />
                {preferredTech.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {preferredTech.map((t) => (
                      <span key={t} className="flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-900/20 px-2.5 py-1 text-xs text-purple-200">
                        {t}
                        <button type="button" onClick={() => onPreferredTechChange(preferredTech.filter((x) => x !== t))} className="hover:text-white"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Excluded tech */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">{t("create.advanced.excluded")}</label>
                <input
                  type="text" placeholder={t("create.advanced.excludedPlaceholder")}
                  value={excludedTechInput} onChange={(e) => onExcludedTechInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === ",") && excludedTechInput.trim()) {
                      e.preventDefault();
                      addExcludedTag();
                    }
                  }}
                  className="w-full px-4 py-3 bg-white/5 border border-white/15 rounded-xl focus:outline-none focus:border-purple-500/60 text-white placeholder-gray-600 transition-colors text-sm"
                />
                {excludedTech.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {excludedTech.map((t) => (
                      <span key={t} className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-900/15 px-2.5 py-1 text-xs text-red-300">
                        {t}
                        <button type="button" onClick={() => onExcludedTechChange(excludedTech.filter((x) => x !== t))} className="hover:text-white"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
