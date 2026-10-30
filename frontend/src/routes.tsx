import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SpaceGate } from "./components/SpaceGate";
// Already bundled with SpaceGate, which shows it to people without a space.
import { CreateSpacePage } from "./pages/CreateSpacePage";

// Component-level lazy loading lets ProtectedRoute check the session before
// React imports the authenticated layout or page. Route-level lazy functions
// would run for every matched route before the guard can render.
export const router = createBrowserRouter([
  { path: "/login", lazy: async () => ({ Component: (await import("./pages/LoginPage")).LoginPage }) },
  { path: "/signup", lazy: async () => ({ Component: (await import("./pages/SignupPage")).SignupPage }) },
  { path: "/forgot-password", lazy: async () => ({ Component: (await import("./pages/ForgotPasswordPage")).ForgotPasswordPage }) },
  { path: "/reset-password", lazy: async () => ({ Component: (await import("./pages/ResetPasswordPage")).ResetPasswordPage }) },
  { path: "/set-password", lazy: async () => ({ Component: (await import("./pages/SetPasswordPage")).SetPasswordPage }) },
  { path: "/calendar/callback", lazy: async () => ({ Component: (await import("./pages/CalendarCallback")).CalendarCallback }) },
  { path: "/client/:token", lazy: async () => ({ Component: (await import("./pages/ClientProjectView")).ClientProjectView }) },
  {
    path: "/",
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
