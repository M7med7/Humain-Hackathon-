import type { Run, RunTask } from '../../../../backend/src/autopilot/models/run';
import type { LlmSession } from '../../../../backend/src/autopilot/services/llm/llmSession';
import { reportFacts } from '../../../../backend/src/autopilot/services/lead.service';
import { ReviewerService } from '../../../../backend/src/autopilot/services/reviewer.service';

function task(id: string, overrides: Partial<RunTask> = {}): RunTask {
  return {
    id,
    title: `Task ${id}`,
    description: 'Work for the launch.',
    acceptanceCriteria: ['Lists 40 creatures'],
    dependsOn: [],
    estimatedDays: 1,
    priority: 'high',
    language: 'en',
    owner: null,
    routing: { taskId: id, executor: 'ai', reason: null, action: null, role: 'writer', rationale: 'writing' },
    status: 'done',
    attempts: 1,
    assignee: null,
    deliverableId: null,
    finishedAtHour: 2,
    feedback: null,
    origin: 'plan',
    ...overrides,
  };
}

describe('reportFacts', () => {
  const run: Run = {
    id: 'run',
    startedAt: '2026-11-01T08:00:00Z',
    title: 'Game launch',
    objective: 'Plan the game launch',
    deadlineDays: 90,
    lang: 'en',
    summary: 'Design, specs and marketing',
    status: 'running',
    tasks: [task('t1'), task('t2', { title: 'Creature list', attempts: 3, deliverableId: 'd2' })],
    requests: [
      { id: 'r1', taskId: 't2', kind: 'approve', assignee: 'Sara', title: 'Review needed: Creature list', prompt: 'Agents could not fully meet the criteria.', options: ['Accept as is', 'I will finish it'], openedAtHour: 1, status: 'answered', response: 'Accept as is', reminders: 0, reassigned: false, effortHours: 0 },
    ],
    deliverables: [{ id: 'd2', taskId: 't2', attempt: 3, format: 'markdown', content: 'List', model: 'fast', review: { passed: false, checks: [], judge: { passed: false, feedback: 'Too short' } }, acceptedBy: 'Sara' }],
    events: [
      { seq: 0, hour: 1, actor: 'reviewer', kind: 'decided', type: 'rejected', summary: 'Rejected "Creature list": too short', taskId: 't2' },
      { seq: 1, hour: 1, actor: 'lead', kind: 'decided', type: 'escalated', summary: 'Agents missed the criteria for "Creature list" 3 times; asking a person', taskId: 't2' },
    ],
    calls: [],
    report: null,
    stopReason: null,
  };

  it("states the person's answer so the report cannot call accepted work rejected", () => {
    const facts = reportFacts(run);
    expect(facts).toContain('Sara accepted the work as is');
    expect(facts).toContain('Sara answered "Accept as is" to "Review needed: Creature list"');
    expect(facts).toContain('Delivered on working day 1 of 90');
    expect(facts).toContain('asking a person');
    expect(facts).not.toContain('Rejected');
  });
});

describe('ReviewerService', () => {
  it('shows the judge the whole of a long deliverable', async () => {
    let prompt = '';
    const llm = { json: async (request: { prompt: string }) => { prompt = request.prompt; return { passed: true, failedCriteria: [], feedback: '' }; } } as unknown as LlmSession;
    const entries = Array.from({ length: 40 }, (_, index) => `### ${index + 1}. Creature ${index + 1}\n* **Combat Role:** Tank\n* **Habitat:** Ash plains, near the crater rim and the old roads.\n${'Lore that runs long. '.repeat(15)}`);
    const content = entries.join('\n\n');
    expect(content.length).toBeGreaterThan(12_000);

    const review = await new ReviewerService(llm, { model: 'standard', tiered: true }).review(task('t1'), content, 'markdown', { personFinishes: false, sources: '', provided: 'Plan the game launch', otherTasks: [] });
    expect(review.passed).toBe(true);
    expect(prompt).toContain('### 40. Creature 40');
    expect(prompt).not.toContain('Only the first');
  });
});
