import { useTranslation } from 'react-i18next';
import { Check, Plus, X } from 'lucide-react';
import type { Person } from '../types';

const MAX_PEOPLE = 8;

interface PeopleFieldProps {
  /** Everyone in the space, as people Autopilot can assign. */
  members: Person[];
  /** The current selection: chosen members plus outside people. */
  people: Person[];
  onChange: (people: Person[]) => void;
}

function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Choose who can approve or act: members of the space first, outside people by name. */
export function PeopleField({ members, people, onChange }: PeopleFieldProps) {
  const { t } = useTranslation('autopilot');
  const chosen = new Set(people.flatMap((person) => (person.userId ? [person.userId] : [])));
  const outside = people.filter((person) => !person.userId);
  const full = people.length >= MAX_PEOPLE;

  const toggle = (member: Person): void =>
    onChange(chosen.has(member.userId ?? '') ? people.filter((person) => person.userId !== member.userId) : [...people, member]);
  const updateOutside = (index: number, key: 'name' | 'role', value: string): void => {
    const target = outside[index];
    onChange(people.map((person) => (person === target ? { ...person, [key]: value } : person)));
  };
  const removeOutside = (index: number): void => {
    const target = outside[index];
    onChange(people.filter((person) => person !== target));
  };

  return (
    <fieldset>
      <legend className="text-[14px] font-semibold">{t('home.people')}</legend>
      <p className="text-[12px] text-(--ap-muted) mt-0.5">{t('home.peopleHint')}</p>

      <ul className="flex flex-wrap gap-2 mt-3" aria-label={t('home.fromTeam')}>
        {members.map((member) => {
          const selected = chosen.has(member.userId ?? '');
          return (
            <li key={member.userId}>
              <button
                type="button"
                aria-pressed={selected}
                disabled={!selected && full}
                onClick={() => toggle(member)}
                className={`flex items-center gap-2 rounded-full border ps-1 pe-3 py-1 text-start transition-colors ${
                  selected ? 'border-(--ap-accent) bg-(--ap-accent)/10' : 'border-(--ap-border) bg-(--ap-surface-2) hover:border-(--ap-muted)'
                }`}
              >
                <span
                  className={`grid w-7 h-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${selected ? 'bg-(--ap-accent) text-(--ap-accent-ink)' : 'bg-(--ap-border) text-(--ap-ink)'}`}
                  aria-hidden
                >
                  {selected ? <Check className="w-4 h-4" /> : initials(member.name)}
                </span>
                <span className="leading-tight">
                  <span className="block text-[14px] font-medium">{member.name}</span>
                  <span className="block text-[11px] text-(--ap-muted)">{member.role}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {outside.length > 0 && (
        <ul className="space-y-2 mt-3">
          {outside.map((person, index) => (
            <li key={`outside-${index}`} className="flex items-center gap-2">
              <input className="ap-field" placeholder={t('home.name')} aria-label={t('home.name')} maxLength={60} value={person.name} onChange={(event) => updateOutside(index, 'name', event.target.value)} />
              <input className="ap-field" placeholder={t('home.role')} aria-label={t('home.role')} maxLength={60} value={person.role} onChange={(event) => updateOutside(index, 'role', event.target.value)} />
              <button type="button" aria-label={`${t('home.remove')} ${person.name}`} className="p-2 rounded-full text-(--ap-muted) hover:bg-(--ap-surface-2)" onClick={() => removeOutside(index)}>
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <button type="button" className="flex items-center gap-1 mt-3 text-[13px] text-(--ap-link)" onClick={() => onChange([...people, { name: '', role: '', userId: null }])}>
          <Plus className="w-4 h-4" aria-hidden /> {t('home.addOutside')}
        </button>
      )}
    </fieldset>
  );
}
