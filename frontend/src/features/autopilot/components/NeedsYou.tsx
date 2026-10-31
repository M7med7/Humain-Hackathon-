import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Eye, FileText, Hand, Scale } from 'lucide-react';
import type { Deliverable, HumanRequest } from '../types';

interface NeedsYouProps {
  requests: HumanRequest[];
  deliverables: Deliverable[];
  onAnswer: (requestId: string, response: string) => Promise<void>;
  /** Opens the agents' latest work for the task the request is about. */
  onView: (deliverable: Deliverable) => void;
  /** Judges see requests but cannot answer them. */
  readOnly?: boolean;
}

const KIND_ICON = { approve: CheckCircle2, provide: FileText, perform: Hand } as const;

/** The client's inbox: only the things a person must decide or do. */
export function NeedsYou({ requests, deliverables, onAnswer, onView, readOnly = false }: NeedsYouProps) {
  const { t } = useTranslation('autopilot');
  const open = [...requests].filter((request) => request.status === 'open').sort((a, b) => Number(a.taskId !== null) - Number(b.taskId !== null));
  if (open.length === 0) return null;

  return (
    <section aria-labelledby="ap-needs-you" className="space-y-3">
      <h2 id="ap-needs-you" className="ap-display text-[21px]">
        {t('needsYou.title')} <span className="text-(--ap-muted) font-normal">· {open.length}</span>
      </h2>
      {open.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          draft={request.taskId ? [...deliverables].reverse().find((deliverable) => deliverable.taskId === request.taskId) : undefined}
          onAnswer={onAnswer}
          onView={onView}
          readOnly={readOnly}
        />
      ))}
    </section>
  );
}

interface RequestCardProps {
  request: HumanRequest;
  draft: Deliverable | undefined;
  onAnswer: NeedsYouProps['onAnswer'];
  onView: NeedsYouProps['onView'];
  readOnly?: boolean;
}

export function RequestCard({ request, draft, onAnswer, onView, readOnly = false }: RequestCardProps) {
  const { t } = useTranslation('autopilot');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const isDecision = request.taskId === null;
  const Icon = isDecision ? Scale : KIND_ICON[request.kind];

  const submit = async (response: string): Promise<void> => {
    setBusy(true);
    try {
      await onAnswer(request.id, response);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={`ap-card p-5 border-s-4 ${isDecision ? 'border-(--ap-accent)' : 'border-(--ap-border)'}`}
      aria-label={request.title}
    >
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${isDecision ? 'text-(--ap-accent)' : 'text-(--ap-muted)'}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] uppercase tracking-wide text-(--ap-muted)">
            {isDecision ? t('needsYou.decision') : t(`needsYou.${request.kind}`)} · {t('needsYou.for', { name: request.assignee })}
          </p>
          <h3 className="text-[17px] font-semibold mt-1" dir="auto">
            {request.title}
          </h3>
          <p className="text-[15px] text-(--ap-muted) mt-1" dir="auto">
            {request.prompt}
          </p>
          {draft && (
            <button type="button" onClick={() => onView(draft)} className="inline-flex items-center gap-1.5 mt-2 text-[14px] text-(--ap-link)">
              <Eye className="w-4 h-4" aria-hidden /> {t('needsYou.viewDraft', { attempt: draft.attempt })}
            </button>
          )}

          {readOnly ? (
            <p className="text-[13px] text-(--ap-muted) mt-3">{t('needsYou.viewOnly')}</p>
          ) : request.options.length > 0 ? (
            <div className="flex flex-wrap gap-2 mt-4">
              {request.options.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  disabled={busy}
                  onClick={() => void submit(option)}
                  className={`ap-pill ${index === 0 ? 'ap-pill-primary' : 'ap-pill-quiet'}`}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : (
            <form
              className="flex gap-2 mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (text.trim()) void submit(text.trim());
              }}
            >
              <input
                className="ap-field"
                value={text}
                maxLength={500}
                placeholder={t('needsYou.answerPlaceholder')}
                aria-label={t('needsYou.answerPlaceholder')}
                onChange={(event) => setText(event.target.value)}
              />
              <button type="submit" disabled={busy || !text.trim()} className="ap-pill ap-pill-primary shrink-0">
                {t('needsYou.send')}
              </button>
            </form>
          )}
        </div>
      </div>
    </article>
  );
}
