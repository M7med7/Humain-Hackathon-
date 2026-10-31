import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../../frontend/src/i18n';
import { ClientMessage } from '../../../frontend/src/features/autopilot/components/ClientMessage';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(cleanup);

it('sends the trimmed message and confirms it', async () => {
  const onSend = vi.fn().mockResolvedValue(undefined);
  render(<ClientMessage onSend={onSend} />);
  const send = screen.getByRole('button', { name: 'Send' });
  const field = screen.getByLabelText(/the client also wants/i);

  await userEvent.type(field, 'Hey');
  expect(send).toBeDisabled();

  await userEvent.clear(field);
  await userEvent.type(field, '  The client also wants a TikTok teaser  ');
  await userEvent.click(send);

  expect(onSend).toHaveBeenCalledWith('The client also wants a TikTok teaser');
  expect(await screen.findByRole('status')).toHaveTextContent('lead agent is reviewing');
  expect(field).toHaveValue('');
});

it('fills an example and shows server errors', async () => {
  const onSend = vi.fn().mockRejectedValue(new Error('This run has already finished.'));
  render(<ClientMessage onSend={onSend} />);

  await userEvent.click(screen.getByRole('button', { name: 'Use an example' }));
  expect(screen.getByLabelText(/the client also wants/i)).toHaveValue('The client also wants a short Instagram video ad for the launch.');

  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This run has already finished.');
});
