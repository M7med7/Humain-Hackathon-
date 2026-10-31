import type { TaskStatus } from './types';

/** One color per task status, shared by the workflow nodes and their detail panel. */
export function taskStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'done':
      return 'var(--ap-good)';
    case 'working':
    case 'review':
      return 'var(--ap-accent)';
    case 'needs_person':
      return 'var(--ap-hybrid)';
    case 'failed':
      return 'var(--ap-bad)';
    default:
      return 'var(--ap-human)';
  }
}
