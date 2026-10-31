import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App.tsx";

// Wake the configured hosted backend immediately. In local development there
// may be no API server, so do not generate a guaranteed console/network error.
const configuredApiUrl = import.meta.env.VITE_API_URL;
if (configuredApiUrl) {
  fetch(`${configuredApiUrl}/health`).catch(() => {});
}

// A tab opened before a deploy asks for page files that no longer exist. Reload once to
// pick up the new version; if it fails again within a minute, let the error show.
const STALE_RELOAD_KEY = "zeroone:stale-file-reload";
const STALE_RELOAD_WINDOW_MS = 60_000;

let reloading = false;

window.addEventListener("vite:preloadError", (event) => {
  // Several files can fail at once; once a reload has started, swallow the rest.
  if (reloading) {
    event.preventDefault();
    return;
  }
  try {
    const lastReload = Number(sessionStorage.getItem(STALE_RELOAD_KEY)) || 0;
    if (Date.now() - lastReload < STALE_RELOAD_WINDOW_MS) return;
    sessionStorage.setItem(STALE_RELOAD_KEY, String(Date.now()));
  } catch {
    // Without storage a reload could repeat forever, so leave the error to the error page.
    return;
  }
  reloading = true;
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
