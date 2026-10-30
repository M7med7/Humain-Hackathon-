import dotenv from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadConfig, type AutopilotConfig, type OptimizationFlags } from '../config';
import { createEngine } from '../index';
import type { Objective } from '../models/plan';
import type { Run } from '../models/run';
import type { ScenarioHooks } from '../services/engine/autopilotEngine';
import { SimulatedPeople } from '../services/engine/people';
import { ResponseCache, type CacheMode } from '../services/llm/responseCache';
import { loadObjectiveCases, type ObjectiveCase, type Split } from './datasets';
import { computeObjectiveMetrics, type ObjectiveMetrics } from './objectiveMetrics';

/**
 * Usage: npm run eval:objectives -- --split dev [--case obj-dev-01] [--repeat 1]
 *        [--disable eventDrivenSupervision,modelCascade,...] [--cache record|replay] [--verbose]
 */
dotenv.config();

const RESULTS_DIR = resolve(__dirname, '../../../../eval/results');

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function withDisabled(config: AutopilotConfig, disabled: readonly string[]): AutopilotConfig {
  const optimizations = { ...config.optimizations };
  for (const name of disabled) {
    if (!(name in optimizations)) throw new Error(`Unknown optimization "${name}"`);
    optimizations[name as keyof OptimizationFlags] = false;
  }
  return { ...config, optimizations };
}

function scenarioFor(testCase: ObjectiveCase): { hooks: ScenarioHooks; silent: Set<number> } {
  const hooks: ScenarioHooks = { clientMessages: [], corruptJobs: new Set() };
  const silent = new Set<number>();
  const messages: Array<{ atProgress: number; message: string }> = [];
  const corrupt = new Set<number>();
  for (const perturbation of testCase.perturbations) {
    if (perturbation.type === 'scope_change') messages.push({ atProgress: perturbation.atProgress, message: perturbation.message });
    if (perturbation.type === 'bad_output') corrupt.add(perturbation.taskIndex);
    if (perturbation.type === 'human_timeout') silent.add(perturbation.humanTaskIndex);
  }
  return { hooks: { ...hooks, clientMessages: messages, corruptJobs: corrupt }, silent };
}

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;

function summaryLine(id: string, metrics: ObjectiveMetrics): string {
  return [
    id.padEnd(11),
    metrics.completed ? 'done' : 'NOT DONE',
    `day ${metrics.deliveryDay}/${metrics.deadlineDays}`,
    `tasks ${metrics.tasks} (ai ${metrics.agentTasks}, hybrid ${metrics.hybridTasks}, human ${metrics.humanTasks})`,
    `agent share ${pct(metrics.agentShare)}`,
    `first-pass ${pct(metrics.firstPassRate)}`,
    `touches ${metrics.humanTouches}`,
    `coverage ${pct(metrics.humanStepCoverage)}`,
    `perturbations ${metrics.perturbationsHandled}/${metrics.perturbationsTotal}`,
    `calls ${metrics.calls}`,
    `tokens ${metrics.tokens}`,
    `$${metrics.costUsd.toFixed(4)}`,
  ].join(' | ');
}

async function main(): Promise<void> {
  const split = arg('split', 'dev') as Split;
  const only = arg('case', '');
  const repeat = Number(arg('repeat', '1'));
  const disabled = arg('disable', '').split(',').filter(Boolean);
  const cacheMode = arg('cache', 'off') as CacheMode;
  const verbose = process.argv.includes('--verbose');
  const config = withDisabled(loadConfig(), disabled);
  const variant = disabled.length ? `no-${disabled.join('-no-')}` : 'full';
  const cases = loadObjectiveCases(split).filter((testCase) => !only || testCase.id === only);
  const outDir = resolve(RESULTS_DIR, 'objectives', split);
  mkdirSync(outDir, { recursive: true });

  for (const testCase of cases) {
    for (let trial = 1; trial <= repeat; trial += 1) {
      const { hooks, silent } = scenarioFor(testCase);
      const cache = new ResponseCache(resolve(RESULTS_DIR, `recordings/objectives.${split}.${testCase.id}.${variant}.t${trial}.json`), cacheMode);
      let printed = 0;
      const onChange = (snapshot: Run): void => {
        if (!verbose) return;
        for (const event of snapshot.events.slice(printed)) process.stdout.write(`  [h${event.hour.toFixed(1)}] ${event.actor}: ${event.summary}\n`);
        printed = snapshot.events.length;
      };
      const engine = createEngine(config, { people: new SimulatedPeople(silent), simulateTimeouts: true, scenario: hooks, cache, onChange });
      const objective: Objective = { objective: testCase.objective, deadlineDays: testCase.deadlineDays, people: testCase.people, context: testCase.context, lang: testCase.lang };
      const run = await engine.start(objective);
      cache.flush();
      const metrics = computeObjectiveMetrics(testCase, run, engine.corruptedTaskIds);
      writeFileSync(resolve(outDir, `${testCase.id}.${variant}.t${trial}.json`), `${JSON.stringify({ case: testCase.id, variant, trial, metrics, run }, null, 1)}\n`);
      process.stdout.write(`${summaryLine(testCase.id, metrics)}${run.stopReason ? ` | stopped: ${run.stopReason}` : ''}\n`);
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
