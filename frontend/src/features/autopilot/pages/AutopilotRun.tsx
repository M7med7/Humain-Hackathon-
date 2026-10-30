import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, ChevronLeft, Timer } from 'lucide-react';
import { autopilotApi } from '../api';
import { ActivityPanel } from '../components/ActivityPanel';
import { Deliverables } from '../components/Deliverables';
import { NeedsYou } from '../components/NeedsYou';
import { StatusPill } from '../components/StatusPill';
import { EfficiencyCard, ReportCard, StatTiles } from '../components/Summary';
import { Timeline } from '../components/Timeline';
import { useRunStream } from '../useRunStream';
import '../autopilot.css';

export function AutopilotRun() {
  const { runId = '' } = useParams();
  const { t } = useTranslation('autopilot');
  const { run, error, replace } = useRunStream(runId);
  const [answerError, setAnswerError] = useState<string | null>(null);

  const answer = async (requestId: string, response: string): Promise<void> => {
    setAnswerError(null);
    try {
      replace(await autopilotApi.answer(runId, requestId, response));
    } catch (cause: unknown) {
      setAnswerError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (!run) {
    return (
      <div className="ap mx-auto max-w-7xl rounded-[28px] bg-(--ap-canvas) p-10 text-(--ap-muted)" role="status">
        {error ?? t('run.loading')}
      </div>
    );
  }

  const live = run.status === 'planning' || run.status === 'running';

  return (
    <div className="ap">
      <div className="mx-auto max-w-7xl rounded-[28px] bg-(--ap-canvas) px-4 py-6 sm:px-8 sm:py-8 space-y-6">
        <Link to="/autopilot" className="inline-flex items-center gap-1 text-[14px] text-(--ap-link)">
          <ChevronLeft className="w-4 h-4 rtl:rotate-180" aria-hidden /> {t('run.back')}
        </Link>

        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={run.status} />
            {run.simulatedTeam && (
              <span title={t('run.simulatedHint')} className="inline-flex items-center gap-1.5 rounded-full border border-(--ap-border) px-2.5 py-1 text-[12px] text-(--ap-muted)">
                <Timer className="w-3.5 h-3.5" aria-hidden /> {t('run.simulated')}
              </span>
            )}
            {run.tasks.length > 0 && (
              <Link to={`/project/${run.id}/health`} className="inline-flex items-center gap-1 text-[14px] text-(--ap-link)">
                {t('run.openProject')} <ArrowUpRight className="w-4 h-4 rtl:-scale-x-100" aria-hidden />
              </Link>
            )}
          </div>
          <h1 className="ap-display text-[26px] sm:text-[34px] max-w-4xl" dir="auto" title={run.objective}>
            {run.title || run.objective}
          </h1>
          {run.summary && (
            <p className="text-[15px] text-(--ap-muted) max-w-3xl" dir="auto">
              {run.summary}
            </p>
          )}
        </header>

        <StatTiles run={run} />

        {run.stopReason && (
          <p role="alert" className="ap-card p-4 text-[14px] text-(--ap-bad)">
            {t('run.stoppedReason', { reason: run.stopReason })}
          </p>
        )}
        {answerError && (
          <p role="alert" className="text-[14px] text-(--ap-bad)">
            {answerError}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6 min-w-0">
            <NeedsYou requests={run.requests} onAnswer={answer} />
            <Timeline run={run} />
            {run.report && <ReportCard report={run.report} preferred={run.lang} />}
            <Deliverables run={run} />
          </div>
          <aside className="space-y-6 lg:sticky lg:top-6 self-start">
            <ActivityPanel events={run.events} live={live} />
            <EfficiencyCard run={run} />
          </aside>
        </div>
      </div>
    </div>
  );
}
