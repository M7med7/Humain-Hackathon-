import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../contexts/LanguageContext";

interface LanguageSwitcherProps {
  className?: string;
}

export function LanguageSwitcher({ className = "" }: LanguageSwitcherProps) {
  const { t } = useTranslation("common");
  const { language, toggleLanguage } = useLanguage();

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className={`flex h-9 items-center gap-1.5 rounded-xl border border-white/15 bg-white/6 px-2.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-white/10 ${className}`}
      aria-label={t("language.switcherAriaLabel")}
      title={t("language.switcherAriaLabel")}
    >
      <Languages className="h-4 w-4" />
      <span>{language === "ar" ? t("language.english") : t("language.arabic")}</span>
    </button>
  );
}
