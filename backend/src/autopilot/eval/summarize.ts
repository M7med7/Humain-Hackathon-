/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { Run } from '../models/run';
import { inventedLinks } from '../services/review/checks';
import { loadObjectiveCases } from './datasets';
import type { ObjectiveMetrics } from './objectiveMetrics';
import type { RoutingMetrics } from './routingMetrics';

/** Usage: npm run eval:summary  →  writes eval/RESULTS.md from the recorded result files. */
const RESULTS_DIR = resolve(__dirname, '../../../../eval/results');
const OUTPUT = resolve(__dirname, '../../../../eval/RESULTS.md');

interface ObjectiveResult {
  case: string;
  variant: string;
  trial: number;
  metrics: ObjectiveMetrics;
  run: Run;
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;
const money = (value: number): string => `$${value.toFixed(3)}`;
const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function objectiveResults(folder: string): ObjectiveResult[] {
  const dir = resolve(RESULTS_DIR, 'objectives', folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJson<ObjectiveResult>(resolve(dir, file)));
}

function routingSection(): string[] {
  const rows: Array<[string, string]> = [
    ['Keyword rules (no model)', 'routing.heldout.keywords.json'],
    ['Batched router: 1 call per 20 tasks', 'routing.heldout.batched.gemini-3.1-flash-lite.minimal.json'],
    ['Per-task router: 1 call per task', 'routing.heldout.per-task.gemini-3.1-flash-lite.minimal.json'],
  ];
  const lines = [
    '## 1. Routing: who should do each task (40 held-out tasks)',
    '',
    '| Router | Accuracy | Missed a needed person | Sent a person needlessly | Right reason | Arabic accuracy | Model calls | Cost |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const [label, file] of rows) {
    const path = resolve(RESULTS_DIR, file);
    if (!existsSync(path)) continue;
    const m = readJson<{ metrics: RoutingMetrics }>(path).metrics;
    lines.push(`| ${label} | ${pct(m.accuracy)} | ${pct(m.missedHumanRate)} | ${pct(m.unnecessaryHumanRate)} | ${pct(m.reasonAccuracy)} | ${pct(m.arabicAccuracy)} | ${m.calls} | ${money(m.costUsd)} |`);
  }
  return lines;
}

function inventedLinkCount(results: ObjectiveResult[]): { deliverables: number; withLinks: number } {
  const cases = new Map(loadObjectiveCases('heldout').map((testCase) => [testCase.id, testCase]));
  let deliverables = 0;
  let withLinks = 0;
  for (const result of results) {
    const testCase = cases.get(result.case);
    const provided = `${testCase?.objective ?? ''}\n${testCase?.context ?? ''}`;
    for (const deliverable of result.run.deliverables.filter((item) => item.review?.passed)) {
      deliverables += 1;
      if (inventedLinks(deliverable.content, provided).length > 0) withLinks += 1;
    }
  }
  return { deliverables, withLinks };
}

function heldoutSection(): string[] {
  const results = objectiveResults('heldout').filter((result) => result.variant === 'full');
  if (results.length === 0) return [];
  const byCase = new Map<string, ObjectiveResult[]>();
  for (const result of results) byCase.set(result.case, [...(byCase.get(result.case) ?? []), result]);
  const ok = (result: ObjectiveResult): boolean => result.metrics.onTime && result.metrics.perturbationsHandled === result.metrics.perturbationsTotal;
  const passAll = [...byCase.values()].filter((trials) => trials.every(ok)).length;
  const lines = [
    `## 2. End to end: ${byCase.size} held-out objectives, ${results.length} runs`,
    '',
    '| Objective | Trial | Delivered | Done or prepared by agents | First-pass review | Requests to people | Human checkpoints in plan | Injected problems handled | Calls | Tokens | Cost |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const [id, trials] of [...byCase.entries()].sort()) {
    for (const { trial, metrics: m } of trials.sort((a, b) => a.trial - b.trial)) {
      lines.push(
        `| ${id} | ${trial} | ${m.completed ? `day ${m.deliveryDay} of ${m.deadlineDays}` : 'not finished'} | ${pct(m.agentShare)} | ${pct(m.firstPassRate)} | ${m.humanTouches} | ${pct(m.humanStepCoverage)} | ${m.perturbationsHandled}/${m.perturbationsTotal} | ${m.calls} | ${m.tokens} | ${money(m.costUsd)} |`,
      );
    }
  }
  const all = results.map((result) => result.metrics);
  const fixed = inventedLinkCount(results);
  const before = inventedLinkCount(objectiveResults('heldout-v1'));
  lines.push(
    '',
    `- **Completed on time:** ${all.filter((m) => m.onTime).length} of ${all.length} runs. **pass^2** (both trials on time with every injected problem handled): ${passAll} of ${byCase.size} objectives.`,
    `- **Injected problems handled:** ${all.reduce((sum, m) => sum + m.perturbationsHandled, 0)} of ${all.reduce((sum, m) => sum + m.perturbationsTotal, 0)} (scope changes, corrupted agent output, a silent person).`,
    `- **Work done or prepared by agents:** ${pct(mean(all.map((m) => m.agentShare)))} of tasks on average; people were asked ${mean(all.map((m) => m.humanTouches)).toFixed(1)} times per project.`,
    `- **First-pass review acceptance:** ${pct(mean(all.map((m) => m.firstPassRate)))} on average (corrupted tasks excluded).`,
    `- **Cost per project:** ${money(mean(all.map((m) => m.costUsd)))} on average (${Math.round(mean(all.map((m) => m.calls)))} model calls, ${Math.round(mean(all.map((m) => m.tokens)))} tokens); ${money(mean(all.map((m) => m.costPerDeliveredTask)))} per delivered task.`,
    `- **Invented links in accepted deliverables:** ${fixed.withLinks} of ${fixed.deliverables} after the anti-fabrication fix${before.deliverables ? `, versus ${before.withLinks} of ${before.deliverables} in the ${objectiveResults('heldout-v1').length} held-out runs made before it` : ''}.`,
  );
  return lines;
}

function ablationSection(): string[] {
  const results = objectiveResults('dev');
  const variants = [...new Set(results.map((result) => result.variant))].sort((a, b) => (a === 'full' ? -1 : b === 'full' ? 1 : a.localeCompare(b)));
  const lines = [
    '## 3. Ablations: what each optimization saves (dev objectives, one run each)',
    '',
    'Each row switches one optimization off. Runs stopped by the provider quota are reported as such, not counted.',
    '',
    '| Variant | Objective | Finished | Calls | Tokens | Cost | First-pass |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const variant of variants) {
    for (const result of results.filter((item) => item.variant === variant).sort((a, b) => a.case.localeCompare(b.case))) {
      const m = result.metrics;
      const finished = m.completed ? 'yes' : `stopped (${(result.run.stopReason ?? '').includes('429') ? 'provider quota' : 'error'})`;
      lines.push(`| ${variant} | ${result.case} | ${finished} | ${m.calls} | ${m.tokens} | ${money(m.costUsd)} | ${pct(m.firstPassRate)} |`);
    }
  }
  return lines;
}

const header = [
  '# Results',
  '',
  'Generated by `npm run eval:summary` from the files in `eval/results/`. Held-out data was committed before any agent code existed (see `eval/datasets/CHECKSUMS`); every number below comes from recorded runs, and recorded model responses allow replay without an API key.',
  '',
  'Models: Gemini 3.1 Flash-Lite for routing and review, Gemini 3.5 Flash-Lite for planning and writing (free tier).',
  '',
];

const limitations = [
  '## 4. Findings and limitations',
  '',
  '- **Batching trades accuracy for calls.** The batched router uses 2 calls instead of 40 but is 5 points less accurate on held-out tasks and missed one task that needed a person. The keyword baseline scores well because both datasets were written by the same author and share phrasing; it cannot give reasons or roles.',
  '- **Most rejections are the review judge (39 of 48 on held-out), and the hardest cases are missing inputs.** In the Arabic sales objective a task asked for contact details nobody provided: agents either invented them (correctly rejected as fabrication) or left them out (rejected as incomplete). The next step is to detect required data that was never provided and ask a person for it before work starts.',
  '- **Human-checkpoint coverage is a keyword metric** and undercounts valid plans (for example "schedule posts" instead of "publish"). Held-out keywords were not changed to fit results.',
  '- **Simulated people.** End-to-end runs use simulated colleagues who answer on a simulated clock; delivery days measure the plan, not a live team.',
  '- **Free-tier quota** (500 requests per day per Flash-Lite model) stopped several ablation runs; they are listed as stopped rather than counted.',
];

writeFileSync(OUTPUT, `${[...header, ...routingSection(), '', ...heldoutSection(), '', ...ablationSection(), '', ...limitations, ''].join('\n')}\n`);
process.stdout.write(`wrote ${OUTPUT}\n`);
