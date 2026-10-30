type Level = 'info' | 'warn' | 'error';

/**
 * Structured, single-line JSON logs. Callers pass identifiers and counts only:
 * never prompts, deliverable text or credentials.
 */
function write(level: Level, message: string, meta: Record<string, unknown> = {}): void {
  if (process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), scope: 'autopilot', message, ...meta });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>): void => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>): void => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>): void => write('error', message, meta),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
