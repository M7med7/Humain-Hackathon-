import { useEffect } from "react";

export function CalendarCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const error = params.get("error");
  const message = error
    ? "Calendar connection was cancelled."
    : window.opener
      ? "Calendar connected. You can close this window."
      : "Calendar authorization received. Return to 01 Manager.";

  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage({ type: "calendar-oauth", provider: "google", code, error }, window.location.origin);
      window.setTimeout(() => window.close(), 800);
    }
  }, [code, error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-8 text-center text-white">
      <div className="rounded-2xl border border-purple-500/30 bg-purple-950/25 p-8 shadow-2xl shadow-purple-500/20">
        <div className="mb-3 text-xl font-semibold">{message}</div>
        <div className="text-sm text-gray-500">01 Manager Calendar Sync</div>
      </div>
    </div>
  );
}
