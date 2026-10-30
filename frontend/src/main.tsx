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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
