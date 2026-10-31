import '@testing-library/jest-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import i18n from '../../../frontend/src/i18n';
import { AgentsAtWork } from '../../../frontend/src/features/autopilot/components/AgentsAtWork';
import type { Run, RunTask } from '../../../frontend/src/features/autopilot/types';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(cleanup);

const task = (id: string, title: string, role: RunTask['routing']['role'], status: RunTask['status'], attempts = 1): RunTask => ({
  id,
  title,
  description: '',
  acceptanceCriteria: [],
  dependsOn: [],
  estimatedDays: 1,
  priority: 'medium',
  language: 'en',
  routing: { executor: 'ai', reason: null, action: null, role, rationale: '' },
  status,
  attempts,
  assignee: null,
  deliverableId: null,
  finishedAtHour: null,
  origin: 'plan',
});

const run: Run = {
  id: 'r1',
  startedAt: '2026-10-31T09:00:00Z',
  title: 'Launch',
  objective: 'Launch',
  deadlineDays: 10,
  lang: 'en',
  summary: '',
  status: 'running',
  tasks: [task('t1', 'Poster Draft Creation', 'writer', 'working', 2), task('t2', 'Vendor Research', 'researcher', 'waiting')],
  requests: [],
  deliverables: [],
  events: [{ seq: 1, hour: 10, actor: 'reviewer', kind: 'decided', type: 'rejected', summary: 'Rejected "Poster Draft Creation"', taskId: 't1' }],
  calls: [],
  report: null,
  stopReason: null,
};

it('shows which agents are working, on what, and which are asleep', () => {
  render(<AgentsAtWork run={run} />);
  expect(screen.getByRole('heading', { name: 'Agents at work' })).toBeInTheDocument();
  expect(screen.getByText('1 working · 5 asleep')).toBeInTheDocument();

  const writer = screen.getByRole('listitem', { name: 'Writer: Working' });
  expect(within(writer).getByText('Poster Draft Creation')).toBeInTheDocument();
  expect(within(writer).getByText('Attempt 2')).toBeInTheDocument();

  const researcher = screen.getByRole('listitem', { name: 'Researcher: Asleep' });
  expect(within(researcher).getByText(/no model calls/)).toBeInTheDocument();
  expect(within(screen.getByRole('listitem', { name: 'Reviewer: Asleep' })).getByText('Rejected "Poster Draft Creation"')).toBeInTheDocument();
});
