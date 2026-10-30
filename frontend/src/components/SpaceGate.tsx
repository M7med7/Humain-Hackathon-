import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SpaceProvider, useSpaces } from '../contexts/SpaceContext';
import { CreateSpacePage } from '../pages/CreateSpacePage';

function GateContent() {
  const { t } = useTranslation('spaces');
  const { loading, error, spaces, activeSpace, refresh } = useSpaces();

  if (loading && spaces.length === 0) {
    return (
      <div role="status" aria-busy="true" aria-label={t('gate.loading')} className="flex h-screen items-center justify-center app-bg">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
      </div>
    );
  }

  if (error && spaces.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 app-bg px-6 text-center">
        <p className="text-sm text-red-300">{error || t('gate.loadFailed')}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-xl border border-white/15 bg-white/6 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10"
        >
          {t('gate.retry')}
        </button>
      </div>
    );
  }

  if (!activeSpace) return <CreateSpacePage />;

  // Keying by space remounts every page on switch, so no data from the previous space lingers.
  return <Outlet key={activeSpace.id} />;
}

/** Signed-in area: requires the user to be in a space before showing the app. */
export function SpaceGate() {
  return (
    <SpaceProvider>
      <GateContent />
    </SpaceProvider>
  );
}
