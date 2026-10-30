import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Plus, Settings } from 'lucide-react';
import { useSpaces } from '../contexts/SpaceContext';

export function SpaceSwitcher() {
  const { t } = useTranslation('spaces');
  const navigate = useNavigate();
  const { spaces, activeSpace, selectSpace } = useSpaces();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!activeSpace) return null;

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const choose = (spaceId: string) => {
    setOpen(false);
    if (spaceId === activeSpace.id) return;
    selectSpace(spaceId);
    navigate('/');
  };

  return (
    <div ref={ref} className="relative px-4 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('switcher.switch')}
        className="flex w-full items-center gap-3 rounded-xl border app-border app-surface-soft px-3 py-2.5 text-start transition-colors hover:border-purple-500/40"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-purple-600 to-purple-900 text-sm font-bold text-white">
          {activeSpace.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] uppercase tracking-wide app-subtle">{t('switcher.label')}</span>
          <span className="block truncate text-sm font-semibold app-text">{activeSpace.name}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 app-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-x-4 top-full z-40 mt-2 overflow-hidden rounded-xl border app-border app-surface-elevated p-1.5 shadow-2xl shadow-black/50"
          >
            {spaces.map((space) => (
              <button
                key={space.id}
                type="button"
                role="menuitemradio"
                aria-checked={space.id === activeSpace.id}
                onClick={() => choose(space.id)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm app-muted hover:app-surface-soft hover:app-text"
              >
                <span className="min-w-0 flex-1 truncate">{space.name}</span>
                <span className="text-[10px] app-subtle">{t(`roles.${space.role}`)}</span>
                {space.id === activeSpace.id && <Check className="h-3.5 w-3.5 text-purple-400" />}
              </button>
            ))}
            <div className="my-1 h-px app-surface-soft" />
            <button type="button" role="menuitem" onClick={() => go('/space')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm app-muted hover:app-surface-soft hover:app-text">
              <Settings className="h-4 w-4" /> {t('switcher.settings')}
            </button>
            <button type="button" role="menuitem" onClick={() => go('/spaces/new')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm app-muted hover:app-surface-soft hover:app-text">
              <Plus className="h-4 w-4" /> {t('switcher.new')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
