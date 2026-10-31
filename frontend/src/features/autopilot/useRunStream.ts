import { useCallback, useEffect, useState } from 'react';
import { autopilotApi, streamRun } from './api';
import type { Run } from './types';

const MAX_RECONNECTS = 3;
const RECONNECT_DELAY_MS = 2_000;

interface RunStream {
  run: Run | null;
  error: string | null;
  replace: (run: Run) => void;
  /**
   * Opens a fresh live stream. A change can reopen a finished run, or reach a run the
   * server picked back up after a restart; either way the old stream no longer gets updates.
   */
  reconnect: () => void;
}

/** Live view of a run: streams changes while it is active, then loads the stored result. */
export function useRunStream(runId: string): RunStream {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

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
  }, [runId, generation]);

  const reconnect = useCallback(() => setGeneration((current) => current + 1), []);

  return { run, error, replace: setRun, reconnect };
}
