import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Check, KeyRound, Loader2, X } from 'lucide-react';
import { Logo } from '../components/Logo';
import { AuthControls } from '../components/AuthControls';
import { useAuth } from '../contexts/AuthContext';
import { useSpaces } from '../contexts/SpaceContext';
import { api, SPACE_DESCRIPTION_MAX_LENGTH, SPACE_KEY_MAX_LENGTH, SPACE_KEY_PATTERN } from '../lib/api';

const MAX_NAME_LENGTH = 80;
const KEY_CHECK_DELAY_MS = 400;

type KeyStatus = 'empty' | 'invalid' | 'checking' | 'available' | 'taken' | 'unknown';

// Keys are uppercase letters and digits only, starting with a letter.
function sanitizeKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, SPACE_KEY_MAX_LENGTH);
}

function suggestKey(name: string): string {
  return sanitizeKey(name.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^[0-9]+/, ''));
}

function KeyStatusHint({ status }: { status: KeyStatus }) {
  const { t } = useTranslation('spaces');
  if (status === 'empty') return null;
  const styles: Record<Exclude<KeyStatus, 'empty'>, string> = {
    invalid: 'text-amber-400',
    checking: 'text-gray-500',
    available: 'text-emerald-400',
    taken: 'text-red-400',
    unknown: 'text-gray-500',
  };
  const icon = {
    invalid: null,
    checking: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    available: <Check className="h-3.5 w-3.5" />,
    taken: <X className="h-3.5 w-3.5" />,
    unknown: null,
  }[status];
  return (
    <p role="status" className={`mt-2 flex items-center gap-1.5 text-xs ${styles[status]}`}>
      {icon}
      {t(`create.keyStatus.${status}`)}
    </p>
  );
}

// Live preview of how the space will appear, so the key's role is concrete.
function SpacePreview({ name, spaceKey, description }: { name: string; spaceKey: string; description: string }) {
  const { t } = useTranslation('spaces');
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <aside aria-label={t('create.preview')} className="hidden lg:block">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('create.preview')}</p>
      <div className="relative overflow-hidden rounded-3xl border app-border app-surface-soft p-7 shadow-2xl shadow-purple-950/30">
        <div className="pointer-events-none absolute -end-16 -top-16 h-48 w-48 rounded-full bg-purple-600/20 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-purple-600 to-purple-900 text-2xl font-bold text-white">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold text-white">{name.trim() || t('create.previewName')}</p>
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 font-mono text-xs tracking-wider text-purple-300" dir="ltr">
              <KeyRound className="h-3 w-3" />
              {spaceKey || 'KEY'}
            </p>
          </div>
        </div>
        <p className="relative mt-6 min-h-16 text-sm leading-relaxed text-gray-400 wrap-break-word">
          {description.trim() || t('create.previewDescription')}
        </p>
        <div className="relative mt-6 flex items-center justify-between border-t app-border pt-4 text-xs text-gray-500">
          <span>{t('create.previewMembers')}</span>
          <span className="rounded-full border border-purple-500/40 bg-purple-500/15 px-2.5 py-0.5 font-semibold text-purple-300">{t('roles.Admin')}</span>
        </div>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-gray-500">{t('create.keyExplainer')}</p>
    </aside>
  );
}

// Shown after sign-up when the person has no space yet, and from the space
// switcher ("New space") when they want another one.
export function CreateSpacePage() {
  const { t } = useTranslation('spaces');
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const { spaces, createSpace, refresh } = useSpaces();
  const isFirstSpace = spaces.length === 0;
  const [name, setName] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [availability, setAvailability] = useState<{ key: string; available: boolean | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The key follows the name until the person types their own.
  const spaceKey = keyEdited ? keyDraft : suggestKey(name);
  const keyIsValid = SPACE_KEY_PATTERN.test(spaceKey);

  let keyStatus: KeyStatus = 'checking';
  if (!spaceKey) keyStatus = 'empty';
  else if (!keyIsValid) keyStatus = 'invalid';
  else if (availability?.key === spaceKey) {
    keyStatus = availability.available === null ? 'unknown' : availability.available ? 'available' : 'taken';
  }

  useEffect(() => {
    if (!keyIsValid) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.spaces
        .checkKey(spaceKey)
        .then((result) => !cancelled && setAvailability({ key: spaceKey, available: result.available }))
        // The server validates again on submit, so a failed check never blocks the form.
        .catch(() => !cancelled && setAvailability({ key: spaceKey, available: null }));
    }, KEY_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [spaceKey, keyIsValid]);

  const canSubmit = !submitting && name.trim() !== '' && keyIsValid && keyStatus !== 'taken';

  const handleKeyChange = (value: string) => {
    setKeyDraft(sanitizeKey(value));
    setKeyEdited(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createSpace({ name: name.trim(), key: spaceKey, description: description.trim() });
      navigate('/', { replace: true });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409) setAvailability({ key: spaceKey, available: false });
      setError(err instanceof Error ? err.message : t('create.failed'));
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const inputClass =
    'w-full rounded-xl border border-white/15 bg-white/6 px-4 py-3 text-white placeholder-gray-600 outline-none transition-colors focus:border-purple-400/70';

  return (
    <div className="min-h-screen app-bg px-6 py-16">
      <AuthControls />
      <div className="mx-auto grid w-full max-w-4xl items-center gap-16 lg:min-h-[calc(100vh-8rem)] lg:grid-cols-[minmax(0,1fr)_360px]">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-md lg:mx-0">
          <div className="mb-10 flex flex-col items-start gap-4">
            <Logo />
            <h1 className="text-3xl font-bold text-white">{isFirstSpace ? t('create.title') : t('create.newTitle')}</h1>
            <p className="text-gray-400">{t('create.subtitle')}</p>
          </div>

          {error && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 rounded-xl border border-red-500/50 bg-red-900/30 p-4 text-sm text-red-300"
            >
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            <div>
              <label htmlFor="space-name" className="mb-2 block text-sm font-semibold text-gray-300">{t('create.nameLabel')}</label>
              <input
                id="space-name"
                type="text"
                required
                autoFocus
                maxLength={MAX_NAME_LENGTH}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('create.namePlaceholder')}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="space-key" className="mb-2 block text-sm font-semibold text-gray-300">{t('create.keyLabel')}</label>
              <input
                id="space-key"
                type="text"
                required
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                maxLength={SPACE_KEY_MAX_LENGTH}
                value={spaceKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                placeholder="ZEROONE"
                aria-describedby="space-key-help"
                className={`${inputClass} font-mono tracking-[0.2em] uppercase`}
              />
              <KeyStatusHint status={keyStatus} />
              <p id="space-key-help" className="mt-2 text-xs leading-relaxed text-gray-500">{t('create.keyHelp')}</p>
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <label htmlFor="space-description" className="text-sm font-semibold text-gray-300">
                  {t('create.descriptionLabel')} <span className="font-normal text-gray-500">{t('create.optional')}</span>
                </label>
                <span className="text-xs tabular-nums text-gray-500">{description.length}/{SPACE_DESCRIPTION_MAX_LENGTH}</span>
              </div>
              <textarea
                id="space-description"
                dir="auto"
                rows={4}
                maxLength={SPACE_DESCRIPTION_MAX_LENGTH}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('create.descriptionPlaceholder')}
                className={`${inputClass} resize-none leading-relaxed`}
              />
            </div>

            <motion.button
              type="submit"
              disabled={!canSubmit}
              whileHover={canSubmit ? { y: -1 } : {}}
              whileTap={canSubmit ? { scale: 0.98 } : {}}
              className="w-full rounded-xl bg-linear-to-r from-purple-600 to-purple-900 py-3 font-semibold text-white shadow-lg shadow-purple-500/20 transition-opacity disabled:opacity-50"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('create.submitting')}
                </span>
              ) : (
                t('create.submit')
              )}
            </motion.button>
          </form>

          {isFirstSpace ? (
            <div className="mt-8 space-y-3 text-sm text-gray-500">
              <p>
                {t('create.waitingInvite', { email: session?.user.email ?? '' })}{' '}
                <button type="button" onClick={() => void refresh()} className="font-semibold text-purple-400 hover:text-purple-300">
                  {t('create.checkAgain')}
                </button>
              </p>
              <button type="button" onClick={handleSignOut} className="text-gray-500 hover:text-gray-300">
                {t('create.signOut')}
              </button>
            </div>
          ) : (
            <p className="mt-8 text-sm">
              <button type="button" onClick={() => navigate(-1)} className="font-semibold text-purple-400 hover:text-purple-300">
                {t('create.cancel')}
              </button>
            </p>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <SpacePreview name={name} spaceKey={spaceKey} description={description} />
        </motion.div>
      </div>
    </div>
  );
}
