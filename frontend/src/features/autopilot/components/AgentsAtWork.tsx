import { useTranslation } from 'react-i18next';
import { Calculator, Check, Compass, Hammer, ListChecks, Moon, PenLine, Route, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
import { agentActivity, type AgentCard } from '../agents';
import type { Run } from '../types';

const ICONS: Record<string, LucideIcon> = {
  planner: ListChecks,
  router: Route,
  'agent:researcher': Search,
  'agent:writer': PenLine,
  'agent:analyst': Calculator,
  'agent:builder': Hammer,
  reviewer: ShieldCheck,
  lead: Compass,
};

const nameKey = (actor: string): string => `agents.names.${actor.replace('agent:', '')}`;

/** Every agent in the run and what it is doing right now, like a live view of parallel sessions. */
export function AgentsAtWork({ run }: { run: Run }) {
  const { t } = useTranslation('autopilot');
  const cards = agentActivity(run);
  const active = cards.filter((card) => card.state === 'active').length;
  const sleeping = cards.filter((card) => card.state === 'sleeping').length;
  const finished = cards.every((card) => card.state === 'done');

  return (
    <section aria-labelledby="ap-agents" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ap-agents" className="ap-display text-[21px]">
          {t('agents.title')}
        </h2>
        <p className="text-[13px] text-(--ap-muted)" aria-live="polite">
          {finished ? t('agents.allDone') : t('agents.summary', { active, sleeping })}
        </p>
      </div>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((card) => (
          <AgentTile key={card.actor} card={card} />
        ))}
      </ul>
    </section>
  );
}

function AgentTile({ card }: { card: AgentCard }) {
  const { t } = useTranslation('autopilot');
  const Icon = ICONS[card.actor] ?? PenLine;
  const isActive = card.state === 'active';
  const detail = isActive ? (card.tasks[0] ?? (card.activity ? t(`agents.doing.${card.activity}`) : null)) : card.lastAction;

  return (
    <li
      className="ap-card p-4 border transition-colors"
      style={{ borderColor: isActive ? 'var(--ap-accent)' : 'transparent' }}
      aria-label={`${t(nameKey(card.actor))}: ${t(`agents.state.${card.state}`)}`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: isActive ? 'var(--ap-accent)' : 'var(--ap-surface-2)', color: isActive ? 'var(--ap-accent-ink)' : 'var(--ap-muted)' }}
        >
          <Icon className="w-4 h-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold truncate">{t(nameKey(card.actor))}</p>
          <StateChip card={card} />
        </div>
      </div>
      {isActive && card.activity === 'working' && <p className="text-[12px] text-(--ap-muted) mt-3">{t('agents.doing.working')}</p>}
      {isActive && card.activity === 'reviewing' && <p className="text-[12px] text-(--ap-muted) mt-3">{t('agents.doing.reviewing')}</p>}
      {detail && (
        <p className={`text-[13px] leading-snug line-clamp-2 ${isActive ? 'mt-1 font-medium' : 'mt-3 text-(--ap-muted)'}`} dir="auto" title={detail}>
          {detail}
        </p>
      )}
      {!isActive && !detail && <p className="text-[13px] mt-3 text-(--ap-muted)">{card.state === 'done' ? t('agents.doneHint') : t('agents.asleepHint')}</p>}
      <p className="text-[12px] text-(--ap-muted) mt-2">
        {card.attempt && card.attempt > 1 ? t('agents.attempt', { attempt: card.attempt }) : card.finished > 0 ? t('agents.finished', { count: card.finished }) : ' '}
      </p>
    </li>
  );
}

function StateChip({ card }: { card: AgentCard }) {
  const { t } = useTranslation('autopilot');
  if (card.state === 'active') {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-(--ap-accent)">
        <span className="ap-live inline-block h-2 w-2 rounded-full bg-(--ap-accent)" aria-hidden />
        {t('agents.state.active')}
      </span>
    );
  }
  const ChipIcon = card.state === 'sleeping' ? Moon : Check;
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-(--ap-muted)">
      <ChipIcon className="w-3 h-3" aria-hidden style={card.state === 'done' ? { color: 'var(--ap-good)' } : undefined} />
      {t(`agents.state.${card.state}`)}
    </span>
  );
}
