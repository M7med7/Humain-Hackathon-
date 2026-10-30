import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setActiveSpaceId, type NewSpace, type Space } from '../lib/api';
import { useAuth } from './AuthContext';

const ACTIVE_SPACE_KEY = 'zeroone-active-space';

interface SpaceContextValue {
  spaces: Space[];
  activeSpace: Space | null;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  selectSpace: (spaceId: string) => void;
  createSpace: (input: NewSpace) => Promise<Space>;
  refresh: () => Promise<void>;
}

const SpaceContext = createContext<SpaceContextValue | null>(null);

function readStoredSpace(userId: string): string | null {
  try {
    return localStorage.getItem(`${ACTIVE_SPACE_KEY}:${userId}`);
  } catch {
    return null;
  }
}

function storeSpace(userId: string, spaceId: string) {
  try {
    localStorage.setItem(`${ACTIVE_SPACE_KEY}:${userId}`, spaceId);
  } catch {
    // Storage can be unavailable (private mode); the first space is used instead.
  }
}

export function SpaceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The API header must be set before pages mount and fire their requests,
  // so it is updated together with state rather than in an effect.
  const activate = useCallback((spaceId: string | null) => {
    setActiveSpaceId(spaceId);
    setActiveId(spaceId);
    if (spaceId && userId) storeSpace(userId, spaceId);
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { spaces: mine } = await api.spaces.list();
      setSpaces(mine);
      const stored = readStoredSpace(userId);
      const next = mine.find((s) => s.id === stored) ?? mine[0] ?? null;
      activate(next?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your spaces.');
    } finally {
      setLoading(false);
    }
  }, [userId, activate]);

  useEffect(() => {
    // Loading spaces is the intended reaction to a (new) signed-in user.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const createSpace = useCallback(async (input: NewSpace) => {
    const { space } = await api.spaces.create(input);
    setSpaces((current) => [...current, space]);
    activate(space.id);
    return space;
  }, [activate]);

  const value = useMemo<SpaceContextValue>(() => {
    const activeSpace = spaces.find((s) => s.id === activeId) ?? null;
    return {
      spaces,
      activeSpace,
      loading,
      error,
      isAdmin: activeSpace?.role === 'Admin',
      selectSpace: activate,
      createSpace,
      refresh,
    };
  }, [spaces, activeId, loading, error, activate, createSpace, refresh]);

  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>;
}

export function useSpaces(): SpaceContextValue {
  const ctx = useContext(SpaceContext);
  if (!ctx) throw new Error('useSpaces must be used inside SpaceProvider');
  return ctx;
}
