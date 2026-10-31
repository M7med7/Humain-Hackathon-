import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { EVIDENCE_LINKS } from '../../../lib/projectLinks';
import type { RunSummary } from '../types';

/** The four places on a run page that show what the agents did, in reading order. */
const GUIDE_STEPS = [
  { key: 'agents', anchor: 'ap-agents' },
  { key: 'workflow', anchor: 'ap-workflow' },
  { key: 'activity', anchor: 'ap-activity' },
  { key: 'results', anchor: 'ap-deliverables' },
] as const;

/** Landing card: what to look at on a run, and one button to the best example. Judges also get the evidence links. */
export function StartHere({ runs, showEvidence }: { runs: RunSummary[]; showEvidence: boolean }) {
  const { t } = useTranslation('autopilot');
  const featured = runs.find((run) => run.status === 'completed') ?? runs[0];
  if (!featured && !showEvidence) return null;
  return (
    <section aria-labelledby="ap-guide-start" className="ap-card mt-10 p-5 sm:p-7">
      <h2 id="ap-guide-start" className="ap-display text-[24px]">
        {t('guide.title')}
      </h2>
      <p className="text-[15px] text-(--ap-muted) mt-1">{t('guide.intro')}</p>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2">
        {GUIDE_STEPS.map((step, index) => (
          <li key={step.key} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-(--ap-accent-ink)" style={{ background: 'var(--ap-accent)' }}>
              {index + 1}
            </span>
            <div>
              <p className="text-[15px] font-semibold">{t(`guide.steps.${step.key}.title`)}</p>
              <p className="text-[13px] text-(--ap-muted)">{t(`guide.steps.${step.key}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        {featured && (
          <Link to={`/autopilot/${featured.id}`} className="ap-pill ap-pill-primary inline-flex items-center gap-2 text-[15px] px-6 py-2.5">
            {t('guide.open')} <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden />
          </Link>
        )}
        {showEvidence &&
          EVIDENCE_LINKS.map((link) => (
            <a key={link.key} href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[14px] text-(--ap-link)">
              {t(`guide.evidence.${link.key}`)} <ExternalLink className="w-3.5 h-3.5" aria-hidden />
            </a>
          ))}
      </div>
    </section>
  );
}

/** A numbered strip on the run page that jumps to each section. */
export function RunGuide() {
  const { t } = useTranslation('autopilot');
  return (
    <nav aria-label={t('guide.strip')} className="ap-card flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="text-[13px] text-(--ap-muted) me-1">{t('guide.strip')}</span>
      {GUIDE_STEPS.map((step, index) => (
        <button
          key={step.key}
          type="button"
          onClick={() => document.getElementById(step.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="inline-flex items-center gap-1.5 rounded-full border border-(--ap-border) px-3 py-1 text-[13px] hover:border-(--ap-accent)"
        >
          <span className="font-semibold text-(--ap-accent)">{index + 1}</span> {t(`guide.steps.${step.key}.title`)}
        </button>
      ))}
    </nav>
  );
}
