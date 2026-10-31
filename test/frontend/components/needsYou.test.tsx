import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../../frontend/src/i18n';
import { NeedsYou } from '../../../frontend/src/features/autopilot/components/NeedsYou';
import type { Deliverable, HumanRequest } from '../../../frontend/src/features/autopilot/types';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(cleanup);

const request = (id: string, taskId: string | null, title: string): HumanRequest => ({
  id,
  taskId,
  kind: 'approve',
  assignee: 'Mohammed',
  title,
  prompt: 'Please decide.',
  options: ['Accept as is', 'I will take over'],
  openedAtHour: 10,
  status: 'open',
  response: null,
});

const draft = (attempt: number): Deliverable => ({ id: `d${attempt}`, taskId: 't1', attempt, format: 'markdown', content: 'Poster copy', model: 'fast', review: null });

it('stacks every open request and links each to the work it is about', async () => {
  const onView = vi.fn();
  render(
    <NeedsYou
      requests={[request('r1', 't1', 'Review needed: Poster Draft Creation'), request('r2', null, 'Scope change affects the deadline')]}
      deliverables={[draft(1), draft(2), draft(3)]}
      onAnswer={vi.fn()}
      onView={onView}
    />,
  );
  expect(screen.getByRole('heading', { name: /Needs you/ })).toHaveTextContent('2');
  expect(screen.getAllByRole('article')).toHaveLength(2);

  await userEvent.click(screen.getByRole('button', { name: 'View the draft (attempt 3)' }));
  expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: 'd3' }));
  expect(screen.getAllByRole('button', { name: /View the draft/ })).toHaveLength(1);
});
