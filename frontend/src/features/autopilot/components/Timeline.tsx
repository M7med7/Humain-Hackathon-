import { useTranslation } from 'react-i18next';
import { currentHour, HOURS_PER_DAY, startHours, timelineScale } from '../format';
import type { Executor, Run, RunTask } from '../types';

const EXECUTOR_COLOR: Record<Executor, string> = { ai: 'var(--ap-ai)', hybrid: 'var(--ap-hybrid)', human: 'var(--ap-human)' };
const ACTIVE = new Set<RunTask['status']>(['working', 'review', 'needs_person']);
const MIN_BAR_PERCENT = 1.2;
/** Past this share of the axis, labels sit before their mark so they stay inside the card. */
const END_LABEL_PERCENT = 85;
const END_ALIGNED = '-translate-x-full rtl:translate-x-full pe-1';

/** Tasks on a working-day axis: who does each one, when it ran, and where the deadline is. */
export function Timeline({ run }: { run: Run }) {
  const { t } = useTranslation('autopilot');
  const now = currentHour(run);
  const starts = startHours(run);
  const lastFinish = Math.max(now, ...run.tasks.map((task) => task.finishedAtHour ?? 0));
  const scale = timelineScale(lastFinish, run.deadlineDays, t('run.day'));
  const at = (hour: number): number => Math.min(100, (hour / scale.spanHours) * 100);
  const deadlineAt = at(run.deadlineDays * HOURS_PER_DAY);
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

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-(--ap-muted) mb-3">
        {(['ai', 'hybrid', 'human'] as const).map((executor) => (
          <span key={executor} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: EXECUTOR_COLOR[executor] }} />
            {t(`timeline.legend${executor === 'ai' ? 'Ai' : executor === 'hybrid' ? 'Hybrid' : 'Human'}`)}
          </span>
        ))}
        {!scale.deadlineInView && <span className="ms-auto text-(--ap-bad) font-medium">{t('timeline.deadlineDay', { day: run.deadlineDays })}</span>}
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
        <div className="relative h-5 text-[11px] text-(--ap-muted) whitespace-nowrap" aria-hidden>
          {scale.ticks.map((tick) => (
            <span key={tick.hour} className={`absolute top-0 ${at(tick.hour) > END_LABEL_PERCENT ? END_ALIGNED : ''}`} style={{ insetInlineStart: `${at(tick.hour)}%` }}>
              {tick.label}
            </span>
          ))}
          {scale.deadlineInView && (
            <>
              <span className="absolute -top-[calc(100%+0.25rem)] h-[200%] border-s-2 border-dashed border-(--ap-bad)" style={{ insetInlineStart: `${deadlineAt}%` }} />
              <span className={`absolute top-0 bg-(--ap-surface) text-(--ap-bad) font-medium ${deadlineAt > END_LABEL_PERCENT ? END_ALIGNED : 'ps-1'}`} style={{ insetInlineStart: `${deadlineAt}%` }}>
                {t('timeline.deadline')}
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
