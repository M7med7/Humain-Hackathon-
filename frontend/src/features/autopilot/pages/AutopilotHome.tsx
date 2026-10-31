import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gamepad2, Sparkles } from 'lucide-react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useSpaces } from '../../../contexts/SpaceContext';
import { autopilotApi } from '../api';
import { StartHere } from '../components/Guide';
import { PeopleField } from '../components/PeopleField';
import { StatusPill } from '../components/StatusPill';
import type { NewRun, Person, RunSummary } from '../types';
import '../autopilot.css';

const MIN_OBJECTIVE = 10;

const EXAMPLE: NewRun = {
  objective:
    'Launch the Ramadan campaign for our specialty coffee brand Qahwa Lab by November 20: a bilingual landing page, a launch email sequence and a two-week social plan.',
  deadlineDays: 10,
  people: [],
  context:
    'Qahwa Lab runs 6 cafes in Riyadh and sells beans online. Ramadan offer: 20% off the Ramadan Blend and free delivery after Iftar. Brand voice: warm, modern, proudly Saudi. Media budget: 40,000 SAR.',
  lang: 'en',
  simulateTeam: true,
};

const EXAMPLE_OUTSIDE_PEOPLE: Person[] = [
  { name: 'Sara Al-Qahtani', role: 'Marketing Director', userId: null },
  { name: 'Omar Haddad', role: 'Brand Designer', userId: null },
];

/** A game studio scenario: agents prepare design and launch material, people build, approve and publish. */
const GAME_OBJECTIVE =
  'Get Sandstorm Depths, our original 2D side-scrolling sandbox survival game built in Unity, to a playable Steam demo within 30 working days. Agents prepare the game design document, the item and crafting table, enemy and boss design with stats, C# architecture notes for each gameplay system, the Steam store page and the Next Fest launch plan; our team builds the game, draws the art, tests it and publishes.';

const gameContext = (director: string): string =>
  `${director} is the game director: they sign off the game design document and the store page before they are used. Khalid Al-Mutairi (Unity developer) builds the game in Unity 6 (C#, 2D URP) and Nora Al-Qahtani (pixel artist) draws the 16x16 pixel art. QA, spending approval and publishing go to the matching people on the team. World: an original desert setting with buried cities and creatures from Arabian folklore (ghouls, djinn, the Sand Wyrm boss); the genre is 2D sandbox survival in the spirit of Terraria. Demo scope: one biome, about 25 items, 8 enemy types, one boss, 20 to 30 minutes of play, a day-night cycle with enemy waves. Platform: PC on Steam, English and Arabic. Budget: 80,000 SAR.`;

const GAME_TEAM: Person[] = [
  { name: 'Khalid Al-Mutairi', role: 'Unity Developer', userId: null },
  { name: 'Nora Al-Qahtani', role: 'Pixel Artist', userId: null },
];
const MAX_PEOPLE = 8;

const EMPTY: NewRun = { objective: '', deadlineDays: 10, people: [], context: '', lang: 'en', simulateTeam: true };

function isValid(form: NewRun): boolean {
  return (
    form.objective.trim().length >= MIN_OBJECTIVE &&
    form.people.length > 0 &&
    form.people.every((person) => person.name.trim().length >= 2 && person.role.trim().length >= 2)
  );
}

export function AutopilotHome() {
  const { t } = useTranslation('autopilot');
  const navigate = useNavigate();
  const [form, setForm] = useState<NewRun>(EMPTY);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Person[]>([]);
  const { activeSpace } = useSpaces();
  const { isJudge, session } = useAuth();

  useEffect(() => {
    autopilotApi.listRuns().then(setRuns).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  // Space members are the default people: their human tasks land on them in ZeroOne.
  useEffect(() => {
    if (!activeSpace) return;
    api.spaces
      .members(activeSpace.id)
      .then(({ members: rows }) => {
        const team = rows.map((member) => ({ name: member.full_name || member.email, role: member.job_title || member.role, userId: member.id }));
        setMembers(team);
        setForm((current) => (current.people.length === 0 ? { ...current, people: team } : current));
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [activeSpace]);

  const fillGameExample = (): void => {
    const director = members.find((member) => member.userId === session?.user.id)?.name ?? members[0]?.name ?? 'The project lead';
    const team = [...members.slice(0, MAX_PEOPLE - GAME_TEAM.length), ...GAME_TEAM];
    setForm({ objective: GAME_OBJECTIVE, deadlineDays: 30, people: team, context: gameContext(director), lang: 'en', simulateTeam: true });
  };

  const update = <K extends keyof NewRun>(key: K, value: NewRun[K]): void => setForm((current) => ({ ...current, [key]: value }));

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

        {isJudge ? (
          <StartHere runs={runs} showEvidence />
        ) : (
        <form onSubmit={(event) => void submit(event)} className="ap-card mt-10 p-5 sm:p-7 space-y-6">
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="ap-objective" className="text-[17px] font-semibold">
                {t('home.objective')}
              </label>
              <div className="flex items-center gap-4">
                <button type="button" onClick={fillGameExample} className="flex items-center gap-1 text-[13px] text-(--ap-link)">
                  <Gamepad2 className="w-4 h-4" aria-hidden /> {t('home.exampleGame')}
                </button>
                <button type="button" onClick={() => setForm({ ...EXAMPLE, people: members.length > 1 ? members : [...members, ...EXAMPLE_OUTSIDE_PEOPLE] })} className="flex items-center gap-1 text-[13px] text-(--ap-link)">
                  <Sparkles className="w-4 h-4" aria-hidden /> {t('home.example')}
                </button>
              </div>
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

            <PeopleField members={members} people={form.people} onChange={(people) => update('people', people)} />
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
        )}
        {!isJudge && <StartHere runs={runs} showEvidence={false} />}

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
