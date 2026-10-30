import type { RoutingDecision } from '../models/routing';
import type { LlmCallRecord } from '../models/run';
import type { RoutingCase } from './datasets';

export interface RoutingMetrics {
  cases: number;
  accuracy: number;
  /** Share of tasks that need a person but were sent to an agent alone (the costly error). */
  missedHumanRate: number;
  /** Share of agent-only tasks that were sent to a person (wasted human time). */
  unnecessaryHumanRate: number;
  /** Reason accuracy over correctly routed hybrid/human tasks. */
  reasonAccuracy: number;
  arabicAccuracy: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  errors: Array<{ id: string; expected: string; got: string }>;
}

const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

export function computeRoutingMetrics(
  cases: readonly RoutingCase[],
  decisions: readonly RoutingDecision[],
  calls: readonly LlmCallRecord[],
): RoutingMetrics {
  const byId = new Map(decisions.map((decision) => [decision.taskId, decision]));
  let correct = 0;
  let needsPerson = 0;
  let missedPerson = 0;
  let agentOnly = 0;
  let sentToPerson = 0;
  let reasonPool = 0;
  let reasonCorrect = 0;
  let arabic = 0;
  let arabicCorrect = 0;
  const errors: RoutingMetrics['errors'] = [];

  for (const testCase of cases) {
    const got = byId.get(testCase.id)?.executor ?? 'missing';
    const hit = got === testCase.executor;
    if (hit) correct += 1;
    else errors.push({ id: testCase.id, expected: testCase.executor, got });
    if (testCase.lang === 'ar') {
      arabic += 1;
      if (hit) arabicCorrect += 1;
    }
    if (testCase.executor === 'ai') {
      agentOnly += 1;
      if (got === 'hybrid' || got === 'human') sentToPerson += 1;
    } else {
      needsPerson += 1;
      if (got === 'ai') missedPerson += 1;
      if (hit) {
        reasonPool += 1;
        if (byId.get(testCase.id)?.reason === testCase.reason) reasonCorrect += 1;
      }
    }
  }

  return {
    cases: cases.length,
    accuracy: ratio(correct, cases.length),
    missedHumanRate: ratio(missedPerson, needsPerson),
    unnecessaryHumanRate: ratio(sentToPerson, agentOnly),
    reasonAccuracy: ratio(reasonCorrect, reasonPool),
    arabicAccuracy: ratio(arabicCorrect, arabic),
    calls: calls.length,
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: calls.reduce((sum, call) => sum + call.outputTokens + call.thinkingTokens, 0),
    costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
    latencyMs: calls.reduce((sum, call) => sum + call.latencyMs, 0),
    errors,
  };
}
