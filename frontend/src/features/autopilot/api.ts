import { authHeaders, BASE_URL } from '../../lib/api';
import type { NewRun, Run, RunSummary } from './types';

const ROOT = `${BASE_URL}/autopilot`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ROOT}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...init?.headers } });
  } catch (error: unknown) {
    throw new Error('Could not reach the server. Make sure the backend is running.', { cause: error });
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

export const autopilotApi = {
  createRun: (input: NewRun): Promise<{ id: string }> => call('/runs', { method: 'POST', body: JSON.stringify(input) }),
  listRuns: async (): Promise<RunSummary[]> => (await call<{ runs: RunSummary[] }>('/runs')).runs,
  getRun: (id: string): Promise<Run> => call(`/runs/${id}`),
  answer: (runId: string, requestId: string, response: string): Promise<Run> =>
    call(`/runs/${runId}/requests/${requestId}/answer`, { method: 'POST', body: JSON.stringify({ response }) }),
  sendMessage: (runId: string, message: string): Promise<{ accepted: boolean }> =>
    call(`/runs/${runId}/messages`, { method: 'POST', body: JSON.stringify({ message }) }),
};

/**
 * Reads the server-sent event stream with fetch, so the auth headers can be sent
 * (EventSource cannot set headers). Resolves when the server closes the stream.
 */
export async function streamRun(id: string, onRun: (run: Run) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${ROOT}/runs/${id}/stream`, { headers: await authHeaders(), signal });
  if (!response.ok || !response.body) throw new Error(`Live updates unavailable (${response.status})`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const message = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = message
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('');
      if (data) onRun(JSON.parse(data) as Run);
    }
  }
}
