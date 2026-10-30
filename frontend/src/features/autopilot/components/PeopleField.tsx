import { useTranslation } from 'react-i18next';
import { Plus, UserRound, X } from 'lucide-react';
import type { Person } from '../types';

const MAX_PEOPLE = 8;

interface PeopleFieldProps {
  people: Person[];
  onChange: (people: Person[]) => void;
}

/** Space members (real ZeroOne users) plus outside people named for this objective. */
export function PeopleField({ people, onChange }: PeopleFieldProps) {
  const { t } = useTranslation('autopilot');
  const update = (index: number, key: 'name' | 'role', value: string): void =>
    onChange(people.map((person, i) => (i === index ? { ...person, [key]: value } : person)));
  const remove = (index: number): void => onChange(people.filter((_, i) => i !== index));

  return (
    <fieldset>
      <legend className="text-[14px] font-semibold">{t('home.people')}</legend>
      <p className="text-[12px] text-(--ap-muted) mt-0.5">{t('home.peopleHint')}</p>
      <ul className="space-y-2 mt-3">
        {people.map((person, index) => (
          <li key={person.userId ?? `outside-${index}`} className="flex items-center gap-2">
            {person.userId ? (
              <div className="flex flex-1 items-center gap-2.5 rounded-xl bg-(--ap-surface-2) border border-(--ap-border) px-3 py-2">
                <UserRound className="w-4 h-4 text-(--ap-accent)" aria-hidden />
                <span className="text-[15px] font-medium truncate">{person.name}</span>
                <span className="text-[13px] text-(--ap-muted) truncate">{person.role}</span>
                <span className="ms-auto shrink-0 text-[11px] font-semibold uppercase text-(--ap-accent)">{t('home.member')}</span>
              </div>
            ) : (
              <>
                <input className="ap-field" placeholder={t('home.name')} aria-label={t('home.name')} maxLength={60} value={person.name} onChange={(event) => update(index, 'name', event.target.value)} />
                <input className="ap-field" placeholder={t('home.role')} aria-label={t('home.role')} maxLength={60} value={person.role} onChange={(event) => update(index, 'role', event.target.value)} />
              </>
            )}
            {people.length > 1 && (
              <button type="button" aria-label={`${t('home.remove')} ${person.name}`} className="p-2 rounded-full text-(--ap-muted) hover:bg-(--ap-surface-2)" onClick={() => remove(index)}>
                <X className="w-4 h-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {people.length < MAX_PEOPLE && (
        <button type="button" className="flex items-center gap-1 mt-2 text-[13px] text-(--ap-link)" onClick={() => onChange([...people, { name: '', role: '', userId: null }])}>
          <Plus className="w-4 h-4" aria-hidden /> {t('home.addOutside')}
        </button>
      )}
    </fieldset>
  );
}
