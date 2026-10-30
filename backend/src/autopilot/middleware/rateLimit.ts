import type { NextFunction, Request, Response } from 'express';

interface Window {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_CALLERS = 5_000;

/**
 * Fixed-window limit per signed-in user. Autopilot routes spend model tokens, so
 * this caps how much one account can spend. In-memory: one limiter per process.
 */
export function rateLimit(options: { limit: number; windowMs: number }) {
  const windows = new Map<string, Window>();
  return (_req: Request, res: Response, next: NextFunction): void => {
    const key = String(res.locals.userId ?? 'anonymous');
    const now = Date.now();
    const current = windows.get(key);
    const window = !current || current.resetAt <= now ? { count: 0, resetAt: now + options.windowMs } : current;
    window.count += 1;
    if (windows.size >= MAX_TRACKED_CALLERS && !windows.has(key)) windows.clear();
    windows.set(key, window);
    if (window.count > options.limit) {
      res.setHeader('Retry-After', String(Math.ceil((window.resetAt - now) / 1_000)));
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    next();
  };
}
