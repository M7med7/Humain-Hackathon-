import dotenv from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadConfig } from '../config';
import type { RoutingDecision } from '../models/routing';
import { GeminiTransport } from '../services/llm/geminiTransport';
import { LlmSession } from '../services/llm/llmSession';
import { ResponseCache, type CacheMode } from '../services/llm/responseCache';
import type { ThinkingLevel } from '../services/llm/types';
import { RouterService } from '../services/router.service';
import { loadRoutingCases, type Split } from './datasets';
import { keywordRoute } from './keywordRouter';
import { computeRoutingMetrics } from './routingMetrics';

/**
 * Usage: npm run eval:routing -- --split dev --variant batched [--model m] [--thinking low] [--cache record|replay]
 * Variants: batched (default), per-task, keywords (baseline, no model).
 */
dotenv.config();

const RESULTS_DIR = resolve(__dirname, '../../../../eval/results');

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const split = arg('split', 'dev') as Split;
  const variant = arg('variant', 'batched');
  const thinking = arg('thinking', 'minimal') as ThinkingLevel;
  const cacheMode = arg('cache', 'off') as CacheMode;
  const cases = loadRoutingCases(split);
  const tasks = cases.map(({ id, title, description }) => ({ id, title, description }));

  let decisions: RoutingDecision[];
  let session: LlmSession | null = null;
  let label = variant;
  if (variant === 'keywords') {
    decisions = keywordRoute(tasks);
  } else {
    const config = loadConfig();
    const model = arg('model', config.models.fast);
    label = `${variant}.${model}.${thinking}`;
    const cache = new ResponseCache(resolve(RESULTS_DIR, `recordings/routing.${split}.${label}.json`), cacheMode);
    const transport = new GeminiTransport({
      apiKey: config.geminiApiKey,
      timeoutMs: config.llmTimeoutMs,
      maxRetries: config.llmMaxRetries,
      fallbackModel: config.models.fallback,
      cache,
    });
    session = new LlmSession(transport, config.runTokenBudget);
    const router = new RouterService(session, { model, batched: variant !== 'per-task', thinking });
    decisions = await router.route(tasks);
    cache.flush();
  }

  const metrics = computeRoutingMetrics(cases, decisions, session?.calls ?? []);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(resolve(RESULTS_DIR, `routing.${split}.${label}.json`), `${JSON.stringify({ split, label, metrics, decisions }, null, 2)}\n`);

  process.stdout.write(
    [
      `routing ${split} | ${label} | ${metrics.cases} tasks`,
      `accuracy ${pct(metrics.accuracy)} | missed-human ${pct(metrics.missedHumanRate)} | unnecessary-human ${pct(metrics.unnecessaryHumanRate)} | reason ${pct(metrics.reasonAccuracy)} | arabic ${pct(metrics.arabicAccuracy)}`,
      `calls ${metrics.calls} | tokens in ${metrics.inputTokens} out ${metrics.outputTokens} | $${metrics.costUsd.toFixed(5)} | ${metrics.latencyMs}ms`,
      ...metrics.errors.map((error) => `  ${error.id}: expected ${error.expected}, got ${error.got}`),
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
