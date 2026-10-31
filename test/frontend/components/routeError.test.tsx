import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../../frontend/src/i18n';
import { RouteError } from '../../../frontend/src/components/RouteError';
import { isStaleFileError } from '../../../frontend/src/lib/staleFile';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(cleanup);

function renderFailing(error: Error): void {
  const Broken = () => {
    throw error;
  };
  const router = createMemoryRouter([{ path: '/', Component: Broken, ErrorBoundary: RouteError }]);
  render(<RouterProvider router={router} />);
}

it('recognises the ways browsers report a missing page file', () => {
  expect(isStaleFileError(new TypeError('Importing a module script failed.'))).toBe(true);
  expect(isStaleFileError(new TypeError('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true);
  expect(isStaleFileError(new Error("'text/html' is not a valid JavaScript MIME type for module script"))).toBe(true);
  expect(isStaleFileError(new Error('Cannot read properties of undefined'))).toBe(false);
});

it('offers a reload instead of the developer error page when the app was updated', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderFailing(new TypeError('Importing a module script failed.'));
  expect(screen.getByRole('heading', { name: 'A new version of ZeroOne is available.' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  expect(screen.queryByText(/Hey developer/)).not.toBeInTheDocument();
});

it('shows a plain message for other failures', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderFailing(new Error('Cannot read properties of undefined'));
  expect(screen.getByRole('heading', { name: 'Something went wrong.' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to projects' })).toHaveAttribute('href', '/');
});
