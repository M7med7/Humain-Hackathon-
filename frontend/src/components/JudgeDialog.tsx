import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Eye, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface JudgeDialogProps {
  loading: boolean;
  onContinue: () => void;
  onClose: () => void;
}

/** Warns a judge before entering that the demo space is view only. */
export function JudgeDialog({ loading, onContinue, onClose }: JudgeDialogProps) {
  const { t } = useTranslation("auth");
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    continueRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="judge-title"
        className="w-full max-w-md rounded-3xl border border-white/12 bg-[#0e0e14] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-600/20 text-purple-300">
              <Eye className="h-5 w-5" aria-hidden />
            </span>
            <h2 id="judge-title" className="text-lg font-bold text-white">
              {t("judge.title")}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("judge.cancel")} className="rounded-lg p-1.5 text-gray-500 hover:text-gray-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm leading-relaxed text-gray-300">{t("judge.intro")}</p>
        <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-900/20 p-4 text-sm leading-relaxed text-amber-200">
          <p className="font-semibold">{t("judge.warningTitle")}</p>
          <p className="mt-1 text-amber-200/85">{t("judge.warningBody")}</p>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <button
            ref={continueRef}
            type="button"
            disabled={loading}
            onClick={onContinue}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-purple-600 to-purple-900 py-3 font-semibold text-white disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("judge.continue")}
          </button>
          <Link to="/signup" className="text-center text-sm font-semibold text-purple-400 hover:text-purple-300">
            {t("judge.signUpInstead")}
          </Link>
        </div>
      </div>
    </div>
  );
}
