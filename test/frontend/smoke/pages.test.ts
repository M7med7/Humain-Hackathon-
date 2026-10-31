import { describe, expect, it } from 'vitest';

// Every routed page must load without throwing; a failure here is a page that would crash in the app.
const pages: Record<string, () => Promise<Record<string, unknown>>> = {
  CreateProject: () => import('../../../frontend/src/pages/CreateProject'),
  TaskDetails: () => import('../../../frontend/src/pages/TaskDetails'),
  ProjectsDashboard: () => import('../../../frontend/src/pages/ProjectsDashboard'),
  ProjectHealthDashboard: () => import('../../../frontend/src/pages/ProjectHealthDashboard'),
  WeeklyReportPage: () => import('../../../frontend/src/pages/WeeklyReportPage'),
  BoardCalendar: () => import('../../../frontend/src/pages/BoardCalendar'),
  TeamCapacity: () => import('../../../frontend/src/pages/TeamCapacity'),
  PortfolioRoadmap: () => import('../../../frontend/src/pages/PortfolioRoadmap'),
  AdvancedSearch: () => import('../../../frontend/src/pages/AdvancedSearch'),
  SpaceSettings: () => import('../../../frontend/src/pages/SpaceSettings'),
  Profile: () => import('../../../frontend/src/pages/Profile'),
  MigrationPage: () => import('../../../frontend/src/pages/MigrationPage'),
  AutopilotHome: () => import('../../../frontend/src/features/autopilot/pages/AutopilotHome'),
  AutopilotRun: () => import('../../../frontend/src/features/autopilot/pages/AutopilotRun'),
};

describe('routed pages', () => {
  for (const [name, load] of Object.entries(pages)) {
    it(`${name} loads`, async () => {
      const module = await load();
      expect(typeof module[name]).toBe('function');
    });
  }
});
