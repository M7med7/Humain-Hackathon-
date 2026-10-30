import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Sparkles, X } from 'lucide-react';
import { autopilotApi } from '../api';
import { StatusPill } from '../components/StatusPill';
import type { NewRun, RunSummary } from '../types';
import '../autopilot.css';

const MIN_OBJECTIVE = 10;
const MAX_PEOPLE = 8;

const EXAMPLE: NewRun = {
  objective:
    'Launch the Ramadan campaign for our specialty coffee brand Qahwa Lab by November 20: a bilingual landing page, a launch email sequence and a two-week social plan.',
  deadlineDays: 10,
  people: [
    { name: 'Sara Al-Qahtani', role: 'Marketing Director' },
    { name: 'Omar Haddad', role: 'Brand Designer' },
  ],
  context:
    'Qahwa Lab runs 6 cafes in Riyadh and sells beans online. Ramadan offer: 20% off the Ramadan Blend and free delivery after Iftar. Brand voice: warm, modern, proudly Saudi. Media budget: 40,000 SAR.',
  lang: 'en',
  simulateTeam: true,
};

const EMPTY: NewRun = { objective: '', deadlineDays: 10, people: [{ name: '', role: '' }], context: '', lang: 'en', simulateTeam: true };

function isValid(form: NewRun): boolean {
  return form.objective.trim().length >= MIN_OBJECTIVE && form.people.every((person) => person.name.trim().length >= 2 && person.role.trim().length >= 2);
}

export function AutopilotHome() {
  const { t } = useTranslation('autopilot');
  const navigate = useNavigate();
  const [form, setForm] = useState<NewRun>(EMPTY);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    autopilotApi.listRuns().then(setRuns).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const update = <K extends keyof NewRun>(key: K, value: NewRun[K]): void => setForm((current) => ({ ...current, [key]: value }));
  const updatePerson = (index: number, key: 'name' | 'role', value: string): void =>
    update('people', form.people.map((person, i) => (i === index ? { ...person, [key]: value } : person)));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!isValid(form)) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await autopilotApi.createRun({ ...form, objective: form.objective.trim(), context: form.context.trim() });
      navigate(`/autopilot/${id}`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <div className="ap">
      <div className="mx-auto max-w-5xl rounded-[28px] bg-(--ap-canvas) px-5 py-10 sm:px-10 sm:py-14">
        <header className="max-w-3xl">
          <p className="text-[14px] font-semibold text-(--ap-accent)">{t('home.eyebrow')}</p>
          <h1 className="ap-display text-[36px] sm:text-[48px] mt-2 whitespace-pre-line">{t('home.title')}</h1>
          <p className="text-[17px] text-(--ap-muted) mt-4 leading-relaxed">{t('home.subtitle')}</p>
        </header>

        <form onSubmit={(event) => void submit(event)} className="ap-card mt-10 p-5 sm:p-7 space-y-6">
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="ap-objective" className="text-[17px] font-semibold">
                {t('home.objective')}
              </label>
              <button type="button" onClick={() => setForm(EXAMPLE)} className="flex items-center gap-1 text-[13px] text-(--ap-link)">
                <Sparkles className="w-4 h-4" aria-hidden /> {t('home.example')}
              </button>
            </div>
            <textarea
              id="ap-objective"
              className="ap-field mt-2 min-h-24 text-[17px]"
              maxLength={1_000}
              placeholder={t('home.objectivePlaceholder')}
              value={form.objective}
              onChange={(event) => update('objective', event.target.value)}
              dir="auto"
              required
            />
          </div>

          <div className="grid gap-6 sm:grid-cols-[12rem_1fr]">
            <div>
              <label htmlFor="ap-deadline" className="text-[14px] font-semibold">
                {t('home.deadline')}
              </label>
              <div className="flex items-center gap-2 mt-2">
                <input
                  id="ap-deadline"
                  type="number"
                  min={1}
                  max={90}
                  className="ap-field w-24"
                  value={form.deadlineDays}
                  onChange={(event) => update('deadlineDays', Math.min(90, Math.max(1, Number(event.target.value) || 1)))}
                />
                <span className="text-[14px] text-(--ap-muted)">{t('home.days')}</span>
              </div>
            </div>

            <fieldset>
              <legend className="text-[14px] font-semibold">{t('home.people')}</legend>
              <div className="space-y-2 mt-2">
                {form.people.map((person, index) => (
                  <div key={index} className="flex gap-2">
                    <input className="ap-field" placeholder={t('home.name')} aria-label={t('home.name')} maxLength={60} value={person.name} onChange={(event) => updatePerson(index, 'name', event.target.value)} />
                    <input className="ap-field" placeholder={t('home.role')} aria-label={t('home.role')} maxLength={60} value={person.role} onChange={(event) => updatePerson(index, 'role', event.target.value)} />
                    {form.people.length > 1 && (
                      <button type="button" aria-label={t('home.remove')} className="p-2 text-(--ap-muted)" onClick={() => update('people', form.people.filter((_, i) => i !== index))}>
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {form.people.length < MAX_PEOPLE && (
                <button type="button" className="flex items-center gap-1 mt-2 text-[13px] text-(--ap-link)" onClick={() => update('people', [...form.people, { name: '', role: '' }])}>
                  <Plus className="w-4 h-4" aria-hidden /> {t('home.addPerson')}
                </button>
              )}
            </fieldset>
          </div>

          <details>
            <summary className="cursor-pointer text-[14px] font-semibold">{t('home.details')}</summary>
            <textarea className="ap-field mt-2 min-h-24" maxLength={4_000} placeholder={t('home.detailsPlaceholder')} value={form.context} onChange={(event) => update('context', event.target.value)} dir="auto" />
          </details>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex flex-wrap items-center gap-5 text-[14px]">
              <label className="flex items-center gap-2">
                {t('home.language')}
                <select className="ap-field w-auto py-1.5" value={form.lang} onChange={(event) => update('lang', event.target.value as NewRun['lang'])}>
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </label>
              <label className="flex items-center gap-2" title={t('home.simulateHint')}>
                <input type="checkbox" checked={form.simulateTeam} onChange={(event) => update('simulateTeam', event.target.checked)} />
                {t('home.simulateTeam')}
              </label>
            </div>
            <button type="submit" disabled={busy || !isValid(form)} className="ap-pill ap-pill-primary text-[15px] px-7 py-2.5">
              {busy ? t('home.starting') : t('home.start')}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-[14px] text-(--ap-bad)">
              {error}
            </p>
          )}
        </form>

        <section aria-labelledby="ap-recent" className="mt-12">
          <h2 id="ap-recent" className="ap-display text-[21px]">
            {t('home.recent')}
          </h2>
          {runs.length === 0 ? (
            <p className="text-[15px] text-(--ap-muted) mt-3">{t('home.empty')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-(--ap-border) ap-card overflow-hidden">
              {runs.map((run) => (
                <li key={run.id}>
                  <Link to={`/autopilot/${run.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-(--ap-surface-2)">
                    <span className="truncate text-[15px]" dir="auto">
                      {run.objective}
                    </span>
                    <StatusPill status={run.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
