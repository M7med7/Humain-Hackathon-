import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SpaceGate } from "./components/SpaceGate";
// Already bundled with SpaceGate, which shows it to people without a space.
import { CreateSpacePage } from "./pages/CreateSpacePage";
import { RouteError } from "./components/RouteError";

// Component-level lazy loading lets ProtectedRoute check the session before
// React imports the authenticated layout or page. Route-level lazy functions
// would run for every matched route before the guard can render.
export const router = createBrowserRouter([
  { ErrorBoundary: RouteError, path: "/login", lazy: async () => ({ Component: (await import("./pages/LoginPage")).LoginPage }) },
  { ErrorBoundary: RouteError, path: "/signup", lazy: async () => ({ Component: (await import("./pages/SignupPage")).SignupPage }) },
  { ErrorBoundary: RouteError, path: "/forgot-password", lazy: async () => ({ Component: (await import("./pages/ForgotPasswordPage")).ForgotPasswordPage }) },
  { ErrorBoundary: RouteError, path: "/reset-password", lazy: async () => ({ Component: (await import("./pages/ResetPasswordPage")).ResetPasswordPage }) },
  { ErrorBoundary: RouteError, path: "/set-password", lazy: async () => ({ Component: (await import("./pages/SetPasswordPage")).SetPasswordPage }) },
  { ErrorBoundary: RouteError, path: "/calendar/callback", lazy: async () => ({ Component: (await import("./pages/CalendarCallback")).CalendarCallback }) },
  { ErrorBoundary: RouteError, path: "/client/:token", lazy: async () => ({ Component: (await import("./pages/ClientProjectView")).ClientProjectView }) },
  {
    path: "/",
    ErrorBoundary: RouteError,
    Component: ProtectedRoute,
    children: [
      {
        // Every signed-in page runs inside a space; people without one are asked to create it.
        Component: SpaceGate,
        children: [
          { path: "spaces/new", Component: CreateSpacePage },
          {
            Component: lazy(async () => ({ default: (await import("./components/Layout")).Layout })),
            children: [
              { path: "space", Component: lazy(async () => ({ default: (await import("./pages/SpaceSettings")).SpaceSettings })) },
              { index: true, Component: lazy(async () => ({ default: (await import("./pages/ProjectsDashboard")).ProjectsDashboard })) },
              { path: "search", Component: lazy(async () => ({ default: (await import("./pages/AdvancedSearch")).AdvancedSearch })) },
              { path: "roadmap", Component: lazy(async () => ({ default: (await import("./pages/PortfolioRoadmap")).PortfolioRoadmap })) },
              { path: "board", Component: lazy(async () => ({ default: (await import("./pages/BoardCalendar")).BoardCalendar })) },
              { path: "task/:taskId", Component: lazy(async () => ({ default: (await import("./pages/TaskDetails")).TaskDetails })) },
              { path: "team", Component: lazy(async () => ({ default: (await import("./pages/TeamCapacity")).TeamCapacity })) },
              { path: "autopilot", Component: lazy(async () => ({ default: (await import("./features/autopilot/pages/AutopilotHome")).AutopilotHome })) },
              { path: "autopilot/:runId", Component: lazy(async () => ({ default: (await import("./features/autopilot/pages/AutopilotRun")).AutopilotRun })) },
              { path: "create", Component: lazy(async () => ({ default: (await import("./pages/CreateProject")).CreateProject })) },
              { path: "profile", Component: lazy(async () => ({ default: (await import("./pages/Profile")).Profile })) },
              { path: "migrate", Component: lazy(async () => ({ default: (await import("./pages/MigrationPage")).MigrationPage })) },
              { path: "project/:projectId/health", Component: lazy(async () => ({ default: (await import("./pages/ProjectHealthDashboard")).ProjectHealthDashboard })) },
              { path: "project/:projectId/report", Component: lazy(async () => ({ default: (await import("./pages/WeeklyReportPage")).WeeklyReportPage })) },
            ],
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
