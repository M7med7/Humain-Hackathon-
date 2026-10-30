import { useEffect, useState } from 'react';
import { autopilotApi, streamRun } from './api';
import type { Run } from './types';

const MAX_RECONNECTS = 3;
const RECONNECT_DELAY_MS = 2_000;

/** Live view of a run: streams changes while it is active, then loads the stored result. */
export function useRunStream(runId: string): { run: Run | null; error: string | null; replace: (run: Run) => void } {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const connect = async (attempt: number): Promise<void> => {
      try {
        await streamRun(runId, setRun, controller.signal);
        // The server ends the stream once the run is no longer live; load the final stored state.
        setRun(await autopilotApi.getRun(runId));
        setError(null);
      } catch (cause: unknown) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Live updates stopped');
        if (attempt < MAX_RECONNECTS) window.setTimeout(() => void connect(attempt + 1), RECONNECT_DELAY_MS * (attempt + 1));
      }
    };
    void connect(0);
    return () => controller.abort();
  }, [runId]);

  return { run, error, replace: setRun };
}
