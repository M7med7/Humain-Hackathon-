import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code2, FileText, X } from 'lucide-react';
import type { Deliverable, Run } from '../types';

/** Latest accepted deliverable per task, in plan order. */
function accepted(run: Run): Array<{ deliverable: Deliverable; title: string }> {
  return run.tasks.flatMap((task) => {
    const deliverable = [...run.deliverables].reverse().find((item) => item.taskId === task.id && item.review?.passed);
    return deliverable ? [{ deliverable, title: task.title }] : [];
  });
}

export function Deliverables({ run }: { run: Run }) {
  const { t } = useTranslation('autopilot');
  const [open, setOpen] = useState<{ deliverable: Deliverable; title: string } | null>(null);
  const items = accepted(run);

  return (
    <section aria-labelledby="ap-deliverables">
      <h2 id="ap-deliverables" className="ap-display text-[21px] mb-3">
        {t('deliverables.title')} <span className="text-(--ap-muted) font-normal">· {items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-[15px] text-(--ap-muted)">{t('deliverables.empty')}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const checks = item.deliverable.review?.checks ?? [];
            const Icon = item.deliverable.format === 'html' ? Code2 : FileText;
            return (
              <li key={item.deliverable.id}>
                <button
                  type="button"
                  onClick={() => setOpen(item)}
                  className="ap-card w-full text-start p-4 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-(--ap-accent)"
                >
                  <Icon className="w-5 h-5 text-(--ap-accent)" aria-hidden />
                  <p className="text-[15px] font-semibold mt-2 line-clamp-2" dir="auto">
                    {item.title}
                  </p>
                  <p className="text-[12px] text-(--ap-muted) mt-1">
                    {t('deliverables.attempts', { count: item.deliverable.attempt })} · {t('deliverables.checks', { passed: checks.filter((check) => check.passed).length })} ·{' '}
                    {item.deliverable.review?.judge ? t('deliverables.aiReview') : t('deliverables.codeOnly')}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && <DeliverableViewer title={open.title} deliverable={open.deliverable} onClose={() => setOpen(null)} />}
    </section>
  );
}

function DeliverableViewer({ title, deliverable, onClose }: { title: string; deliverable: Deliverable; onClose: () => void }) {
  const { t } = useTranslation('autopilot');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ap ap-card w-full max-w-4xl max-h-[88vh] flex flex-col bg-(--ap-surface)"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-(--ap-border)">
          <h3 className="text-[17px] font-semibold truncate" dir="auto">
            {title}
          </h3>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('deliverables.close')} className="p-1.5 rounded-full hover:bg-(--ap-surface-2)">
            <X className="w-5 h-5" />
          </button>
        </header>
        {deliverable.format === 'html' ? (
          // Generated pages run with every sandbox restriction: no scripts, forms, popups or same-origin access.
          <iframe title={t('deliverables.page')} sandbox="" srcDoc={deliverable.content} className="w-full flex-1 min-h-[70vh] rounded-b-[18px] bg-white" />
        ) : (
          <div className="ap-prose overflow-y-auto px-6 py-5" dir="auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{deliverable.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
