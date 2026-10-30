import { useTranslation } from 'react-i18next';
import { currentHour, HOURS_PER_DAY, startHours } from '../format';
import type { Executor, Run, RunTask } from '../types';

const EXECUTOR_COLOR: Record<Executor, string> = { ai: 'var(--ap-ai)', hybrid: 'var(--ap-hybrid)', human: 'var(--ap-human)' };
const ACTIVE = new Set<RunTask['status']>(['working', 'review', 'needs_person']);
const MIN_BAR_PERCENT = 1.2;

/** Tasks on a working-day axis: who does each one, when it ran, and where the deadline is. */
export function Timeline({ run }: { run: Run }) {
  const { t } = useTranslation('autopilot');
  const now = currentHour(run);
  const starts = startHours(run);
  const lastFinish = Math.max(now, ...run.tasks.map((task) => task.finishedAtHour ?? 0));
  const days = Math.max(run.deadlineDays, Math.ceil(lastFinish / HOURS_PER_DAY));
  const span = days * HOURS_PER_DAY;
  const at = (hour: number): number => Math.min(100, (hour / span) * 100);
  const planned = run.tasks.filter((task) => task.origin === 'plan').length;

  return (
    <section aria-labelledby="ap-timeline" className="ap-card p-5 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2 id="ap-timeline" className="ap-display text-[21px]">
          {t('timeline.title')}
        </h2>
        <p className="text-[13px] text-(--ap-muted)">
          {t('timeline.planned', { count: planned })}
          {planned !== run.tasks.length && <span className="text-(--ap-accent) font-medium"> → {t('timeline.now', { count: run.tasks.length })}</span>}
        </p>
      </header>

      <div className="flex gap-4 text-[12px] text-(--ap-muted) mb-3" aria-hidden>
        {(['ai', 'hybrid', 'human'] as const).map((executor) => (
          <span key={executor} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: EXECUTOR_COLOR[executor] }} />
            {t(`timeline.legend${executor === 'ai' ? 'Ai' : executor === 'hybrid' ? 'Hybrid' : 'Human'}`)}
          </span>
        ))}
      </div>

      <ol className="space-y-1.5">
        {run.tasks.map((task) => {
          const start = starts.get(task.id);
          const end = task.finishedAtHour ?? (ACTIVE.has(task.status) ? now : null);
          const left = start === undefined ? null : at(start);
          const width = start === undefined || end === null ? null : Math.max(MIN_BAR_PERCENT, at(end) - at(start));
          return (
            <li key={task.id} className="grid grid-cols-[minmax(0,15rem)_1fr] items-center gap-3">
              <div className="min-w-0 flex items-center gap-1.5">
                <span className={`truncate text-[13px] ${task.status === 'cancelled' ? 'line-through text-(--ap-muted)' : ''}`} dir="auto" title={task.title}>
                  {task.title}
                </span>
                {task.origin === 'scope_change' && (
                  <span className="shrink-0 text-[10px] font-semibold uppercase rounded-full px-1.5 py-0.5 bg-(--ap-accent) text-(--ap-accent-ink)">{t('timeline.added')}</span>
                )}
              </div>
              <div className="relative h-5 rounded-md bg-(--ap-surface-2)" role="img" aria-label={`${task.title}: ${t(`taskStatus.${task.status}`)}`}>
                {left !== null && width !== null && (
                  <div
                    className={`absolute inset-y-0.5 rounded-[5px] ${ACTIVE.has(task.status) ? 'ap-live' : ''}`}
                    style={{ insetInlineStart: `${left}%`, width: `${width}%`, background: EXECUTOR_COLOR[task.routing.executor], opacity: task.status === 'done' ? 1 : 0.6 }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-[minmax(0,15rem)_1fr] gap-3 mt-2">
        <span />
        <div className="relative h-5 text-[11px] text-(--ap-muted)">
          {Array.from({ length: days }, (_, index) => (
            <span key={index} className="absolute top-0" style={{ insetInlineStart: `${at(index * HOURS_PER_DAY)}%` }}>
              {index + 1}
            </span>
          ))}
          <span className="absolute -top-[calc(100%+0.25rem)] h-[200%] border-s-2 border-dashed border-(--ap-bad)" style={{ insetInlineStart: `${at(run.deadlineDays * HOURS_PER_DAY)}%` }} />
          <span className="absolute top-0 text-(--ap-bad) font-medium ps-1" style={{ insetInlineStart: `${at(run.deadlineDays * HOURS_PER_DAY)}%` }}>
            {t('timeline.deadline')}
          </span>
        </div>
      </div>
    </section>
  );
}
