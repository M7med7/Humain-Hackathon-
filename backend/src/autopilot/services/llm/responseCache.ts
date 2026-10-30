import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { LlmCompletion, LlmRequest } from './types';

export type CacheMode = 'off' | 'record' | 'replay';

type StoredCompletion = Omit<LlmCompletion, 'replayed' | 'latencyMs'> & { latencyMs: number };

/**
 * Records model responses to a JSON file and replays them, so an evaluation can be
 * re-run without an API key and produce identical numbers.
 */
export class ResponseCache {
  private readonly entries: Record<string, StoredCompletion>;

  constructor(
    private readonly filePath: string,
    readonly mode: CacheMode,
  ) {
    this.entries = mode !== 'off' && existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : {};
  }

  static keyFor(request: LlmRequest): string {
    const material = JSON.stringify([
      request.model,
      request.system,
      request.prompt,
      request.jsonSchema ?? null,
      request.temperature,
      request.thinking,
      request.maxOutputTokens,
    ]);
    return createHash('sha256').update(material).digest('hex');
  }

  get(request: LlmRequest): LlmCompletion | null {
    if (this.mode === 'off') return null;
    const stored = this.entries[ResponseCache.keyFor(request)];
    return stored ? { ...stored, replayed: true } : null;
  }

  set(request: LlmRequest, completion: LlmCompletion): void {
    if (this.mode !== 'record') return;
    const { replayed: _replayed, ...stored } = completion;
    this.entries[ResponseCache.keyFor(request)] = stored;
  }

  flush(): void {
    if (this.mode !== 'record') return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(this.entries, null, 1)}\n`);
  }
}
