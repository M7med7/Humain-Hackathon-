import { useTranslation } from 'react-i18next';
import type { RunStatus } from '../types';

const TONE: Record<RunStatus, string> = {
  planning: 'var(--ap-accent)',
  running: 'var(--ap-accent)',
  waiting_on_people: 'var(--ap-warn)',
  completed: 'var(--ap-good)',
  stopped: 'var(--ap-bad)',
};

export function StatusPill({ status }: { status: RunStatus }) {
  const { t } = useTranslation('autopilot');
  const live = status === 'planning' || status === 'running';
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-(--ap-surface-2) px-2.5 py-1 text-[12px] font-medium">
      <span className={`w-2 h-2 rounded-full ${live ? 'ap-live' : ''}`} style={{ background: TONE[status] }} aria-hidden />
      {t(`status.${status}`)}
    </span>
  );
}
