import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterAll, expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => ({
  auth: { session: null as { user: { id: string } } | null, loading: true },
  layoutImported: false,
  dashboardImported: false,
  taskImported: false,
}));

vi.mock('../../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => startup.auth,
}));

vi.mock('../../../frontend/src/pages/LoginPage', () => ({
  LoginPage: () => <h1>Login</h1>,
}));

vi.mock('../../../frontend/src/components/Layout', async () => {
  startup.layoutImported = true;
  const { Outlet } = await import('react-router-dom');
  return { Layout: () => <main><Outlet /></main> };
});

vi.mock('../../../frontend/src/pages/ProjectsDashboard', () => {
  startup.dashboardImported = true;
  return { ProjectsDashboard: () => <h1>Projects</h1> };
});

vi.mock('../../../frontend/src/pages/TaskDetails', () => {
  startup.taskImported = true;
  return { TaskDetails: () => <h1>Task details</h1> };
});

// Space selection has its own tests (spaceGate.test.tsx); here the user already has a space.
vi.mock('../../../frontend/src/components/SpaceGate', async () => {
  const { Outlet } = await import('react-router-dom');
  return { SpaceGate: () => <Outlet /> };
});

import { router as browserRouter } from '../../../frontend/src/routes';

let router: ReturnType<typeof createMemoryRouter> | undefined;

afterAll(() => {
  cleanup();
  router?.dispose();
  browserRouter.dispose();
});

function openRoute(path: string) {
  cleanup();
  router?.dispose();
  router = createMemoryRouter(browserRouter.routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

function expectProtectedModulesUnloaded() {
  expect(startup.layoutImported).toBe(false);
  expect(startup.dashboardImported).toBe(false);
  expect(startup.taskImported).toBe(false);
}

// Import state is intentionally checked in one cold-start journey: React.lazy
// caches modules after the first authenticated visit.
it('defers protected imports until authentication succeeds, preserving public pages and deep links', async () => {
  startup.auth = { session: null, loading: true };
  openRoute('/login');
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expectProtectedModulesUnloaded();

  for (const path of ['/', '/task/example']) {
    startup.auth = { session: null, loading: true };
    openRoute(path);
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expectProtectedModulesUnloaded();
  }

  for (const path of ['/', '/task/example']) {
    startup.auth = { session: null, loading: false };
    openRoute(path);
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
    expect(router?.state.location.pathname).toBe('/login');
    expectProtectedModulesUnloaded();
  }

  for (const [path, heading] of [
    ['/', 'Projects'],
    ['/task/example', 'Task details'],
  ]) {
    startup.auth = { session: { user: { id: 'test-user' } }, loading: false };
    openRoute(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(startup.layoutImported).toBe(true);
  }

  startup.auth = { session: null, loading: false };
  openRoute('/');
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Projects' })).not.toBeInTheDocument();
});
