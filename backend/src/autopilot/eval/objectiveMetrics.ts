import type { Run, RunTask } from '../models/run';
import { deliveryDay } from '../services/engine/schedule';
import { inventedLinks } from '../services/review/checks';
import type { ObjectiveCase } from './datasets';

export interface ObjectiveMetrics {
  completed: boolean;
  tasks: number;
  agentTasks: number;
  hybridTasks: number;
  humanTasks: number;
  /** Share of tasks whose work agents did fully or prepared (ai + hybrid). */
  agentShare: number;
  /** Requests that reached a person (approvals, inputs, actions, escalations). */
  humanTouches: number;
  /** Agent tasks accepted on their first attempt, excluding tasks the scenario corrupted. */
  firstPassRate: number;
  rework: number;
  /** Person-days of estimated effort delivered by agents. */
  personDaysByAgents: number;
  deliveryDay: number;
  deadlineDays: number;
  onTime: boolean;
  /** Expected human checkpoints the plan routed to a person. */
  humanStepCoverage: number;
  /** Accepted deliverables containing links absent from the objective and context. */
  inventedLinkDeliverables: number;
  perturbationsHandled: number;
  perturbationsTotal: number;
  calls: number;
  tokens: number;
  costUsd: number;
  costPerDeliveredTask: number;
  latencyMs: number;
}

const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);
const byPerson = (task: RunTask): boolean => task.routing.executor !== 'ai';

export function computeObjectiveMetrics(testCase: ObjectiveCase, run: Run, corruptedTaskIds: readonly string[]): ObjectiveMetrics {
  const agentWork = run.tasks.filter((task) => task.routing.executor !== 'human');
  const delivered = run.tasks.filter((task) => task.status === 'done');
  // Tasks the scenario corrupted on purpose cannot pass first time; they are scored by perturbation handling instead.
  const corrupted = new Set(corruptedTaskIds);
  const scoredWork = agentWork.filter((task) => !corrupted.has(task.id));
  const firstPass = scoredWork.filter((task) => task.status === 'done' && task.attempts === 1).length;
  const tokens = run.calls.reduce((sum, call) => sum + call.inputTokens + call.outputTokens + call.thinkingTokens, 0);
  const costUsd = run.calls.reduce((sum, call) => sum + call.costUsd, 0);
  const day = deliveryDay(run.tasks);

  return {
    completed: run.status === 'completed',
    tasks: run.tasks.length,
    agentTasks: run.tasks.filter((task) => task.routing.executor === 'ai').length,
    hybridTasks: run.tasks.filter((task) => task.routing.executor === 'hybrid').length,
    humanTasks: run.tasks.filter((task) => task.routing.executor === 'human').length,
    agentShare: ratio(agentWork.length, run.tasks.length),
    humanTouches: run.requests.length,
    firstPassRate: ratio(firstPass, scoredWork.length),
    rework: agentWork.reduce((sum, task) => sum + Math.max(0, task.attempts - 1), 0),
    personDaysByAgents: run.tasks.filter((task) => task.routing.executor === 'ai' && task.status === 'done').reduce((sum, task) => sum + task.estimatedDays, 0),
    deliveryDay: day,
    deadlineDays: run.deadlineDays,
    onTime: run.status === 'completed' && day <= run.deadlineDays,
    humanStepCoverage: humanStepCoverage(testCase, run.tasks),
    inventedLinkDeliverables: run.deliverables.filter((deliverable) => deliverable.review?.passed && inventedLinks(deliverable.content, `${testCase.objective}\n${testCase.context}`).length > 0).length,
    perturbationsHandled: testCase.perturbations.filter((perturbation) => handled(perturbation.type, run, corruptedTaskIds)).length,
    perturbationsTotal: testCase.perturbations.length,
    calls: run.calls.length,
    tokens,
    costUsd,
    costPerDeliveredTask: ratio(costUsd, delivered.length),
    latencyMs: run.calls.reduce((sum, call) => sum + call.latencyMs, 0),
  };
}

function humanStepCoverage(testCase: ObjectiveCase, tasks: readonly RunTask[]): number {
  const personText = tasks.filter(byPerson).map((task) => `${task.title} ${task.description}`.toLowerCase());
  const covered = testCase.expectedHumanSteps.filter((group) => group.some((keyword) => personText.some((text) => text.includes(keyword.toLowerCase()))));
  return ratio(covered.length, testCase.expectedHumanSteps.length);
}

/** Evidence in the activity feed that the system noticed and dealt with the injected problem. */
function handled(type: ObjectiveCase['perturbations'][number]['type'], run: Run, corruptedTaskIds: readonly string[]): boolean {
  const types = new Set(run.events.map((event) => event.type));
  if (type === 'scope_change') return types.has('scope_added') || types.has('scope_unchanged');
  if (type === 'human_timeout') return types.has('reassigned');
  // Bad output counts as handled only if each corrupted task was caught and still delivered.
  return (
    corruptedTaskIds.length > 0 &&
    corruptedTaskIds.every((id) => {
      const caught = run.events.some((event) => event.type === 'rejected' && event.taskId === id);
      return caught && run.tasks.find((task) => task.id === id)?.status === 'done';
    })
  );
}
