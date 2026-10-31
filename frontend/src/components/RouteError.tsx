import { useRouteError } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isStaleFileError } from "../lib/staleFile";

/** Shown instead of the router's developer error page when a route fails to load or render. */
export function RouteError() {
  const error = useRouteError();
  const { t } = useTranslation("errors");
  const stale = isStaleFileError(error);

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-black text-white">
      <div role="alert" className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <h1 className="text-xl font-semibold">{stale ? t("updated") : t("generic")}</h1>
        <p className="mt-2 text-sm text-gray-400">{stale ? t("updatedHint") : t("retry")}</p>
        <div className="mt-5 flex justify-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className="rounded-full bg-purple-600 px-5 py-2 text-sm font-medium hover:bg-purple-500">
            {t("reload")}
          </button>
          <a href="/" className="rounded-full border border-white/15 px-5 py-2 text-sm text-gray-200 hover:bg-white/10">
            {t("home")}
          </a>
        </div>
      </div>
    </main>
  );
}
