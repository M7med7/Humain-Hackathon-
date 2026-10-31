import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import type { RunSummary } from '../types';

/** The four places on a run page that show what the agents did, in reading order. */
const GUIDE_STEPS = [
  { key: 'agents', anchor: 'ap-agents' },
  { key: 'workflow', anchor: 'ap-workflow' },
  { key: 'activity', anchor: 'ap-activity' },
  { key: 'results', anchor: 'ap-deliverables' },
] as const;

/** Judges' landing card: what to look at, and one button to the best example. */
export function JudgeStart({ runs }: { runs: RunSummary[] }) {
  const { t } = useTranslation('autopilot');
  const featured = runs.find((run) => run.status === 'completed') ?? runs[0];
  return (
    <section aria-labelledby="ap-judge-start" className="ap-card mt-10 p-5 sm:p-7">
      <h2 id="ap-judge-start" className="ap-display text-[24px]">
        {t('judgeGuide.title')}
      </h2>
      <p className="text-[15px] text-(--ap-muted) mt-1">{t('judgeGuide.intro')}</p>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2">
        {GUIDE_STEPS.map((step, index) => (
          <li key={step.key} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-(--ap-accent-ink)" style={{ background: 'var(--ap-accent)' }}>
              {index + 1}
            </span>
            <div>
              <p className="text-[15px] font-semibold">{t(`judgeGuide.steps.${step.key}.title`)}</p>
              <p className="text-[13px] text-(--ap-muted)">{t(`judgeGuide.steps.${step.key}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>
      {featured && (
        <Link to={`/autopilot/${featured.id}`} className="ap-pill ap-pill-primary mt-6 inline-flex items-center gap-2 text-[15px] px-6 py-2.5">
          {t('judgeGuide.open')} <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden />
        </Link>
      )}
    </section>
  );
}

/** A numbered strip on the run page that jumps to each section. */
export function JudgeGuideStrip() {
  const { t } = useTranslation('autopilot');
  return (
    <nav aria-label={t('judgeGuide.strip')} className="ap-card flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="text-[13px] text-(--ap-muted) me-1">{t('judgeGuide.strip')}</span>
      {GUIDE_STEPS.map((step, index) => (
        <button
          key={step.key}
          type="button"
          onClick={() => document.getElementById(step.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="inline-flex items-center gap-1.5 rounded-full border border-(--ap-border) px-3 py-1 text-[13px] hover:border-(--ap-accent)"
        >
          <span className="font-semibold text-(--ap-accent)">{index + 1}</span> {t(`judgeGuide.steps.${step.key}.title`)}
        </button>
      ))}
    </nav>
  );
}
