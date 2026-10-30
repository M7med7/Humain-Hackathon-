import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Eye, Zap } from 'lucide-react';
import { actorName } from '../../../lib/taskAgent';
import { clockLabel } from '../format';
import type { RunEvent } from '../types';

const KIND = {
  observed: { icon: Eye, color: 'var(--ap-muted)' },
  decided: { icon: Brain, color: 'var(--ap-hybrid)' },
  acted: { icon: Zap, color: 'var(--ap-accent)' },
} as const;

/** What the agents saw, concluded and did, in order. Follows the newest line while the run is live. */
export function ActivityPanel({ events, live }: { events: RunEvent[]; live: boolean }) {
  const { t } = useTranslation('autopilot');
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [events.length, live]);

  return (
    <section aria-labelledby="ap-activity" className="ap-card p-5 flex flex-col min-h-0">
      <h2 id="ap-activity" className="ap-display text-[17px] mb-1">
        {t('activity.title')}
      </h2>
      <p className="flex gap-3 text-[12px] text-(--ap-muted) mb-3">
        {(Object.keys(KIND) as Array<keyof typeof KIND>).map((kind) => {
          const Icon = KIND[kind].icon;
          return (
            <span key={kind} className="flex items-center gap-1">
              <Icon className="w-3.5 h-3.5" style={{ color: KIND[kind].color }} aria-hidden />
              {t(`activity.${kind}`)}
            </span>
          );
        })}
      </p>
      <ol className="space-y-2.5 overflow-y-auto pe-1 max-h-[34rem]" aria-live="polite">
        {events.map((event) => {
          const Icon = KIND[event.kind].icon;
          return (
            <li key={event.seq} className="flex gap-2.5 text-[13px] leading-snug">
              <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: KIND[event.kind].color }} aria-label={t(`activity.${event.kind}`)} />
              <div className="min-w-0">
                <p className="text-[11px] text-(--ap-muted)">
                  {clockLabel(event.hour, t('run.day'))} · {actorName(event.actor)}
                </p>
                <p className="break-words" dir="auto">
                  {event.summary}
                </p>
              </div>
            </li>
          );
        })}
        <li ref={endRef} aria-hidden />
      </ol>
    </section>
  );
}
