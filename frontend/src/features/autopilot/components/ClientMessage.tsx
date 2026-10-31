import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquarePlus } from 'lucide-react';

const MIN_MESSAGE = 5;
const MAX_MESSAGE = 1_000;

interface ClientMessageProps {
  onSend: (message: string) => Promise<void>;
}

/** Lets the client change the scope mid-run; the lead agent decides what the message changes. */
export function ClientMessage({ onSend }: ClientMessageProps) {
  const { t } = useTranslation('autopilot');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const message = text.trim();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (message.length < MIN_MESSAGE) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(message);
      setText('');
      setSent(true);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="ap-client-message" className="ap-card p-5">
      <div className="flex items-start gap-3">
        <MessageSquarePlus className="w-5 h-5 mt-0.5 shrink-0 text-(--ap-accent)" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="ap-client-message" className="text-[17px] font-semibold">
              {t('clientMessage.title')}
            </h2>
            <button type="button" onClick={() => setText(t('clientMessage.example'))} className="text-[13px] text-(--ap-link)">
              {t('clientMessage.useExample')}
            </button>
          </div>
          <p className="text-[14px] text-(--ap-muted) mt-1">{t('clientMessage.hint')}</p>
          <form className="flex gap-2 mt-3" onSubmit={(event) => void submit(event)}>
            <input
              className="ap-field"
              dir="auto"
              value={text}
              maxLength={MAX_MESSAGE}
              placeholder={t('clientMessage.placeholder')}
              aria-label={t('clientMessage.placeholder')}
              onChange={(event) => {
                setText(event.target.value);
                setSent(false);
              }}
            />
            <button type="submit" disabled={busy || message.length < MIN_MESSAGE} className="ap-pill ap-pill-primary shrink-0">
              {busy ? t('clientMessage.sending') : t('clientMessage.send')}
            </button>
          </form>
          {sent && (
            <p role="status" className="text-[13px] text-(--ap-muted) mt-2">
              {t('clientMessage.sent')}
            </p>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-(--ap-bad) mt-2">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
