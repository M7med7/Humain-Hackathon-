import { useState } from "react";
import { X, Plus, BadgeCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

export type SkillLevel = "beginner" | "intermediate" | "expert";

const LEVELS: SkillLevel[] = ["beginner", "intermediate", "expert"];

const LEVEL_STYLE: Record<SkillLevel, { dot: string; text: string }> = {
  beginner:     { dot: "bg-sky-400",     text: "text-sky-400"     },
  intermediate: { dot: "bg-amber-400",   text: "text-amber-400"   },
  expert:       { dot: "bg-emerald-400", text: "text-emerald-400" },
};

interface SkillsSectionProps {
  skills: string[];
  cvVerifiedSkills: string[];
  skillLevels: Record<string, SkillLevel>;
  preferredTech: string[];
  avoidedTech: string[];
  onSkillsChange: (skills: string[]) => void;
  onSkillLevelChange: (skill: string, level: SkillLevel | null) => void;
  onPreferredTechChange: (tech: string[]) => void;
  onAvoidedTechChange: (tech: string[]) => void;
}

function TagInput({
  value,
  onChange,
  onAdd,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex gap-2 mt-3">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && value.trim()) {
            e.preventDefault();
            onAdd();
          }
        }}
        placeholder={placeholder}
        className="flex-1 bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-purple-400/60"
      />
      <button
        type="button"
        onClick={onAdd}
        disabled={!value.trim()}
        className="px-3 py-2 rounded-xl bg-purple-900/40 border border-purple-500/30 text-purple-300 hover:bg-purple-800/60 disabled:opacity-30 transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

export function SkillsSection({
  skills, cvVerifiedSkills, skillLevels,
  preferredTech, avoidedTech,
  onSkillsChange, onSkillLevelChange,
  onPreferredTechChange, onAvoidedTechChange,
}: SkillsSectionProps) {
  const { t } = useTranslation("common");
  const [addingSkill, setAddingSkill] = useState("");
  const [addingPreferred, setAddingPreferred] = useState("");
  const [addingAvoided, setAddingAvoided] = useState("");

  function addSkill() {
    const s = addingSkill.trim().replace(/,$/, "");
    if (s && !skills.includes(s)) onSkillsChange([...skills, s]);
    setAddingSkill("");
  }

  function addPreferred() {
    const s = addingPreferred.trim().replace(/,$/, "");
    if (s && !preferredTech.includes(s)) onPreferredTechChange([...preferredTech, s]);
    setAddingPreferred("");
  }

  function addAvoided() {
    const s = addingAvoided.trim().replace(/,$/, "");
    if (s && !avoidedTech.includes(s)) onAvoidedTechChange([...avoidedTech, s]);
    setAddingAvoided("");
  }

  function cycleLevel(skill: string) {
    const current = skillLevels[skill];
    const idx = current ? LEVELS.indexOf(current) : -1;
    const next = idx >= LEVELS.length - 1 ? null : LEVELS[idx + 1];
    onSkillLevelChange(skill, next);
  }

  return (
    <div className="space-y-7">
      {/* Core skills */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-base font-bold text-white">{t("profile.page.skillsExpertise")}</h3>
          <span className="text-xs text-gray-500">{t("profile.page.levelHelp")}</span>
        </div>

        {skills.length > 0 ? (
          <div className="flex flex-wrap gap-2 mt-3">
            {skills.map((skill) => {
              const level = skillLevels[skill];
              const ls = level ? LEVEL_STYLE[level] : null;
              const isVerified = cvVerifiedSkills.includes(skill);

              return (
                <div
                  key={skill}
                  className="group flex items-center gap-1.5 rounded-xl border border-purple-500/30 bg-purple-900/20 px-3 py-1.5"
                >
                  {isVerified && (
                    <span title={t("profile.page.cvVerified")}>
                      <BadgeCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    </span>
                  )}
                  <span className="text-sm text-purple-100">{skill}</span>
                  <button
                    type="button"
                    onClick={() => cycleLevel(skill)}
                    title={level ? t("profile.page.changeLevel", { level: t(`profile.page.levels.${level}`) }) : t("profile.page.setLevel")}
                    className="flex items-center"
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full border transition-all ${
                        ls ? `${ls.dot} border-transparent` : "bg-transparent border-gray-600 hover:border-gray-400"
                      }`}
                    />
                  </button>
                  {ls && (
                    <span className={`text-[10px] font-medium ${ls.text} hidden group-hover:inline`}>
                      {t(`profile.page.levels.${level}`)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onSkillsChange(skills.filter((s) => s !== skill))}
                    className="text-gray-600 hover:text-red-400 transition-colors ml-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-500 italic">{t("profile.page.noSkills")}</p>
        )}

        <TagInput
          value={addingSkill}
          onChange={setAddingSkill}
          onAdd={addSkill}
          placeholder={t("profile.page.addSkill")}
        />

        {/* Level legend */}
        <div className="mt-2 flex items-center gap-4">
          {LEVELS.map((l) => (
            <div key={l} className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className={`w-2 h-2 rounded-full ${LEVEL_STYLE[l].dot}`} />
              {t(`profile.page.levels.${l}`)}
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <BadgeCheck className="w-3 h-3 text-emerald-400" /> {t("profile.page.cvVerified")}
          </div>
        </div>
      </div>

      {/* Preferred tech */}
      <div>
        <h3 className="text-base font-bold text-white mb-1">{t("profile.page.preferredTech")}</h3>
        <p className="text-xs text-gray-500">{t("profile.page.preferredTechHelp")}</p>
        {preferredTech.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {preferredTech.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-900/20 px-3 py-1.5 text-sm text-emerald-200"
              >
                {t}
                <button
                  type="button"
                  onClick={() => onPreferredTechChange(preferredTech.filter((x) => x !== t))}
                  className="text-emerald-600 hover:text-red-400 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <TagInput
          value={addingPreferred}
          onChange={setAddingPreferred}
          onAdd={addPreferred}
          placeholder="e.g. TypeScript, PostgreSQL"
        />
      </div>

      {/* Avoided tech */}
      <div>
        <h3 className="text-base font-bold text-white mb-1">{t("profile.page.avoidTech")}</h3>
        <p className="text-xs text-gray-500">{t("profile.page.avoidTechHelp")}</p>
        {avoidedTech.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {avoidedTech.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-900/15 px-3 py-1.5 text-sm text-red-300"
              >
                {t}
                <button
                  type="button"
                  onClick={() => onAvoidedTechChange(avoidedTech.filter((x) => x !== t))}
                  className="text-red-600 hover:text-red-300 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <TagInput
          value={addingAvoided}
          onChange={setAddingAvoided}
          onAdd={addAvoided}
          placeholder="e.g. PHP, Legacy Java"
        />
      </div>
    </div>
  );
}
