import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Send, Trash2, UserRound } from 'lucide-react';
import type { Run, RunEvent } from '../types';

const CHAT_EVENTS = new Set(['change_requested', 'workflow_changed', 'scope_unchanged', 'step_removed']);
const REPLIES = new Set(['workflow_changed', 'scope_unchanged']);
const BUSY = new Set(['working', 'review']);
const STEP_SUGGESTIONS = ['shorter', 'bilingual', 'detail', 'after'] as const;
const MIN_INSTRUCTION = 3;

interface WorkflowChatProps {
  run: Run;
  /** The step the conversation is about, or null for the whole workflow. */
  taskId: string | null;
  readOnly: boolean;
  onChange: (instruction: string, taskId: string | null) => Promise<void>;
  onRemove: (taskId: string) => Promise<void>;
}

/** A conversation with the lead agent about one step or the whole workflow. Changes apply to the run as it goes. */
export function WorkflowChat({ run, taskId, readOnly, onChange, onRemove }: WorkflowChatProps) {
  const { t } = useTranslation('autopilot');
  const [draft, setDraft] = useState('');
  const [sentAfter, setSentAfter] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const task = taskId ? run.tasks.find((item) => item.id === taskId) : undefined;
  const history = run.events.filter((event) => CHAT_EVENTS.has(event.type) && event.taskId === taskId);
  const answered = sentAfter !== null && run.events.some((event) => event.seq > sentAfter && REPLIES.has(event.type) && event.taskId === taskId);
  const waiting = sentAfter !== null && !answered && run.status !== 'stopped';
  const removed = task?.status === 'cancelled';

  const send = async (instruction: string): Promise<void> => {
    const text = instruction.trim();
    if (text.length < MIN_INSTRUCTION || waiting) return;
    setError(null);
    setSentAfter(run.events.at(-1)?.seq ?? -1);
    try {
      await onChange(text, taskId);
      setDraft('');
    } catch (cause: unknown) {
      setSentAfter(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const remove = async (): Promise<void> => {
    if (!taskId) return;
    setError(null);
    try {
      await onRemove(taskId);
      setConfirming(false);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void send(draft);
  };

  const blocked = readOnly
    ? t('workflow.chat.viewOnly')
    : run.status === 'planning' || run.status === 'stopped'
      ? t('workflow.chat.closed')
      : task && BUSY.has(task.status)
        ? t('workflow.chat.busy')
        : null;

  return (
    <div className="mt-4 border-t border-(--ap-border) pt-4 space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-(--ap-muted)">{taskId ? t('workflow.chat.stepTitle') : t('workflow.chat.workflowTitle')}</p>
      {history.length > 0 && (
        <ol className="space-y-2" aria-live="polite">
          {history.map((event) => (
            <ChatLine key={event.seq} event={event} />
          ))}
        </ol>
      )}
      {waiting && <p className="ap-live text-[13px] text-(--ap-accent)">{t('workflow.chat.thinking')}</p>}

      {blocked ? (
        <p className="text-[13px] text-(--ap-muted)">{blocked}</p>
      ) : (
        <>
          {task && !removed && (
            <div className="flex flex-wrap gap-1.5">
              {STEP_SUGGESTIONS.map((key) => (
                <button key={key} type="button" disabled={waiting} onClick={() => void send(t(`workflow.chat.suggest.${key}`))} className="rounded-full border border-(--ap-border) px-2.5 py-1 text-[12px] hover:bg-(--ap-surface-2) disabled:opacity-50">
                  {t(`workflow.chat.suggest.${key}`)}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={submit} className="flex items-end gap-2">
            <label className="sr-only" htmlFor={`ap-chat-${taskId ?? 'workflow'}`}>
              {taskId ? t('workflow.chat.stepTitle') : t('workflow.chat.workflowTitle')}
            </label>
            <textarea
              id={`ap-chat-${taskId ?? 'workflow'}`}
              className="ap-field min-h-16 flex-1 text-[13px]"
              maxLength={1_000}
              placeholder={removed ? t('workflow.chat.restorePlaceholder') : taskId ? t('workflow.chat.stepPlaceholder') : t('workflow.chat.workflowPlaceholder')}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              dir="auto"
            />
            <button type="submit" disabled={waiting || draft.trim().length < MIN_INSTRUCTION} aria-label={t('workflow.chat.send')} className="ap-pill ap-pill-primary p-2.5">
              <Send className="w-4 h-4 rtl:-scale-x-100" aria-hidden />
            </button>
          </form>
          {task && !removed && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              {confirming ? (
                <>
                  <span>{t('workflow.chat.confirmRemove')}</span>
                  <button type="button" onClick={() => void remove()} className="font-semibold text-(--ap-bad)">
                    {t('workflow.chat.remove')}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className="text-(--ap-muted)">
                    {t('workflow.chat.keep')}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 text-(--ap-muted) hover:text-(--ap-bad)">
                  <Trash2 className="w-3.5 h-3.5" aria-hidden /> {t('workflow.chat.removeStep')}
                </button>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-(--ap-bad)">
          {error}
        </p>
      )}
    </div>
  );
}

function ChatLine({ event }: { event: RunEvent }) {
  const { t } = useTranslation('autopilot');
  if (event.type === 'step_removed') return <li className="text-[12px] text-(--ap-muted)">{t('workflow.chat.removed')}</li>;
  const fromPerson = event.type === 'change_requested';
  const Icon = fromPerson ? UserRound : Bot;
  return (
    <li className={`flex items-start gap-2 rounded-xl p-2.5 text-[13px] ${fromPerson ? 'bg-(--ap-surface-2)' : 'border border-(--ap-border)'}`}>
      <Icon className="mt-0.5 w-3.5 h-3.5 shrink-0" aria-hidden style={{ color: fromPerson ? 'var(--ap-muted)' : 'var(--ap-accent)' }} />
      <span className="sr-only">{fromPerson ? t('workflow.chat.you') : t('workflow.chat.lead')}: </span>
      <span dir="auto">{event.summary}</span>
    </li>
  );
}
