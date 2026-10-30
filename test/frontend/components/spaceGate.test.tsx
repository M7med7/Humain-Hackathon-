import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../../frontend/src/i18n';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  checkKey: vi.fn(),
  setActiveSpaceId: vi.fn(),
}));

vi.mock('../../../frontend/src/lib/api', () => ({
  api: { spaces: { list: mocks.list, create: mocks.create, checkKey: mocks.checkKey } },
  setActiveSpaceId: mocks.setActiveSpaceId,
  SPACE_KEY_PATTERN: /^[A-Z][A-Z0-9]{1,9}$/,
  SPACE_KEY_MAX_LENGTH: 10,
  SPACE_DESCRIPTION_MAX_LENGTH: 500,
}));

vi.mock('../../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'user-1', email: 'me@example.com' } }, signOut: vi.fn() }),
}));

// Presentation-only pieces that need theme/language providers.
vi.mock('../../../frontend/src/components/Logo', () => ({ Logo: () => null }));
vi.mock('../../../frontend/src/components/AuthControls', () => ({ AuthControls: () => null }));

import { SpaceGate } from '../../../frontend/src/components/SpaceGate';

const zeroOne = { id: 'space-zeroone', name: 'ZeroOne', key: 'ZEROONE', description: null, created_by: 'user-1', created_at: '2026-01-01', role: 'Admin' };
const acme = { id: 'space-acme', name: 'Acme', key: 'ACME', description: null, created_by: 'user-2', created_at: '2026-02-01', role: 'Developer' };

function renderGate() {
  const router = createMemoryRouter(
    [{ path: '/', Component: SpaceGate, children: [{ index: true, element: <h1>Dashboard</h1> }] }],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  vi.clearAllMocks();
  mocks.checkKey.mockImplementation(async (key: string) => ({ key, available: key !== 'TAKEN' }));
});

afterEach(cleanup);

it('asks people without a space to create one', async () => {
  mocks.list.mockResolvedValue({ spaces: [] });
  renderGate();
  expect(await screen.findByRole('heading', { name: 'Create your space' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
});

it('creates a space and opens the app inside it', async () => {
  mocks.list.mockResolvedValue({ spaces: [] });
  mocks.create.mockResolvedValue({ space: zeroOne });
  renderGate();

  await userEvent.type(await screen.findByLabelText('Space name'), 'ZeroOne');
  await userEvent.type(screen.getByLabelText(/Description/), 'Software studio');
  await screen.findByText('Available');
  await userEvent.click(screen.getByRole('button', { name: 'Create space' }));

  expect(mocks.create).toHaveBeenCalledWith({ name: 'ZeroOne', key: 'ZEROONE', description: 'Software studio' });
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  expect(mocks.setActiveSpaceId).toHaveBeenLastCalledWith('space-zeroone');
});

it('sets the active space for API requests before showing pages', async () => {
  mocks.list.mockResolvedValue({ spaces: [zeroOne, acme] });
  renderGate();
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  expect(mocks.setActiveSpaceId).toHaveBeenCalledWith('space-zeroone');
});

it('reopens the space the person used last', async () => {
  localStorage.setItem('zeroone-active-space:user-1', 'space-acme');
  mocks.list.mockResolvedValue({ spaces: [zeroOne, acme] });
  renderGate();
  await screen.findByRole('heading', { name: 'Dashboard' });
  expect(mocks.setActiveSpaceId).toHaveBeenLastCalledWith('space-acme');
});

it('ignores a remembered space the person no longer belongs to', async () => {
  localStorage.setItem('zeroone-active-space:user-1', 'space-removed');
  mocks.list.mockResolvedValue({ spaces: [acme] });
  renderGate();
  await screen.findByRole('heading', { name: 'Dashboard' });
  expect(mocks.setActiveSpaceId).toHaveBeenLastCalledWith('space-acme');
});

it('offers a retry when spaces cannot be loaded', async () => {
  mocks.list.mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce({ spaces: [zeroOne] });
  renderGate();
  await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument());
});

it('suggests a key from the name until the person types their own', async () => {
  mocks.list.mockResolvedValue({ spaces: [] });
  renderGate();
  const nameInput = await screen.findByLabelText('Space name');
  const keyInput = screen.getByLabelText('Space key');

  await userEvent.type(nameInput, '01 Digital Solutions');
  expect(keyInput).toHaveValue('DIGITALSOL');

  await userEvent.clear(keyInput);
  await userEvent.type(keyInput, 'od-s!');
  expect(keyInput).toHaveValue('ODS');
  await userEvent.type(nameInput, ' Co');
  expect(keyInput).toHaveValue('ODS');
});

it('blocks creating a space with a taken or invalid key', async () => {
  mocks.list.mockResolvedValue({ spaces: [] });
  renderGate();
  await userEvent.type(await screen.findByLabelText('Space name'), 'Taken');
  expect(await screen.findByText('Already taken. Try another key.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create space' })).toBeDisabled();

  const keyInput = screen.getByLabelText('Space key');
  await userEvent.clear(keyInput);
  await userEvent.type(keyInput, '9');
  expect(screen.getByText('Use 2-10 letters or numbers, starting with a letter.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create space' })).toBeDisabled();
  expect(mocks.create).not.toHaveBeenCalled();
});
