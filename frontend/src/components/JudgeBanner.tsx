import { Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";

/** Shown across the app while a judge looks around, so it is clear nothing can be changed. */
export function JudgeBanner() {
  const { t } = useTranslation("auth");
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const createAccount = async () => {
    await signOut();
    navigate("/signup");
  };

  return (
    <div role="status" className="shrink-0 relative z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-purple-700 px-4 py-2 text-center text-xs text-white">
      <span className="flex items-center gap-1.5 font-semibold">
        <Eye className="h-3.5 w-3.5" aria-hidden />
        {t("judge.bannerTitle")}
      </span>
      <span className="text-white/85">{t("judge.bannerBody")}</span>
      <button type="button" onClick={() => void createAccount()} className="rounded-full bg-white px-3 py-0.5 font-semibold text-purple-800 hover:bg-purple-50">
        {t("judge.createAccount")}
      </button>
    </div>
  );
}
