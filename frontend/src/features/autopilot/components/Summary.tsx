import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { compact, deliveryDay, money, spend } from '../format';
import type { Run } from '../types';

/** The four numbers a project owner asks first. */
export function StatTiles({ run }: { run: Run }) {
  const { t } = useTranslation('autopilot');
  const agentWork = run.tasks.filter((task) => task.routing.executor !== 'human');
  const agentDone = agentWork.filter((task) => task.status === 'done').length;
  const waiting = run.requests.filter((request) => request.status === 'open').length;
  const cost = spend(run.calls).costUsd;
  const day = deliveryDay(run.tasks);
  const tiles = [
    { label: t('run.byAgents'), value: `${agentDone}/${agentWork.length}`, hint: t('run.tasksOf', { done: run.tasks.filter((task) => task.status === 'done').length, total: run.tasks.length }) },
    { label: t('run.needsYou'), value: String(waiting), hint: waiting === 0 ? t('run.noneWaiting') : '', accent: waiting > 0 },
    { label: t('run.delivery'), value: t('run.dayOf', { day, total: run.deadlineDays }), hint: run.status === 'completed' ? '' : t('run.projected') },
    { label: t('run.cost'), value: money(cost), hint: `${compact(spend(run.calls).tokens)} tokens` },
  ];
  return (
    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="ap-card px-4 py-3.5">
          <dt className="text-[12px] text-(--ap-muted)">{tile.label}</dt>
          <dd className={`ap-display text-[24px] mt-0.5 ${tile.accent ? 'text-(--ap-accent)' : ''}`}>{tile.value}</dd>
          {tile.hint && <dd className="text-[12px] text-(--ap-muted)">{tile.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function EfficiencyCard({ run }: { run: Run }) {
  const { t } = useTranslation('autopilot');
  const usage = spend(run.calls);
  const delivered = run.tasks.filter((task) => task.status === 'done').length;
  const rows = [
    { label: t('efficiency.calls'), value: String(usage.calls) },
    { label: t('efficiency.tokens'), value: compact(usage.tokens) },
    { label: t('efficiency.lite'), value: `${Math.round(usage.liteShare * 100)}%` },
    { label: t('efficiency.perTask'), value: delivered === 0 ? '—' : money(usage.costUsd / delivered) },
  ];
  return (
    <section aria-labelledby="ap-efficiency" className="ap-card p-5">
      <h2 id="ap-efficiency" className="ap-display text-[17px] mb-3">
        {t('efficiency.title')}
      </h2>
      <dl className="grid grid-cols-2 gap-y-3 gap-x-4">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-[12px] text-(--ap-muted)">{row.label}</dt>
            <dd className="text-[17px] font-semibold">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ReportCard({ report, preferred }: { report: { en: string; ar: string }; preferred: 'en' | 'ar' }) {
  const { t } = useTranslation('autopilot');
  const [lang, setLang] = useState<'en' | 'ar'>(preferred);
  return (
    <section aria-labelledby="ap-report" className="ap-card p-5 sm:p-6">
      <header className="flex items-center justify-between gap-3 mb-3">
        <h2 id="ap-report" className="ap-display text-[21px]">
          {t('report.title')}
        </h2>
        <div role="tablist" className="flex rounded-full bg-(--ap-surface-2) p-0.5 text-[13px]">
          {(['en', 'ar'] as const).map((code) => (
            <button
              key={code}
              role="tab"
              type="button"
              aria-selected={lang === code}
              onClick={() => setLang(code)}
              className={`px-3 py-1 rounded-full ${lang === code ? 'bg-(--ap-surface) shadow-sm font-semibold' : 'text-(--ap-muted)'}`}
            >
              {code === 'en' ? t('report.english') : t('report.arabic')}
            </button>
          ))}
        </div>
      </header>
      <div className="ap-prose" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
        <ReactMarkdown>{report[lang]}</ReactMarkdown>
      </div>
    </section>
  );
}
