import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Session } from '../core/auth/session';

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession used outside a SessionProvider');
  return s;
}

/** Subscribes to auth-state changes so components re-render on login/logout. */
export function useIsAuthenticated(): boolean {
  const s = useSession();
  return useSyncExternalStore(s.subscribe, s.isAuthenticated);
}
