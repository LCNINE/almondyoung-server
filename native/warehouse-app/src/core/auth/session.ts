import type { createTokenManager } from './tokenManager';

type Manager = ReturnType<typeof createTokenManager>;

export type Session = {
  /** Restore a persisted session once at startup (silent auto-login). */
  bootstrap(): Promise<void>;
  /** Synchronous — read by the router guard. */
  isAuthenticated(): boolean;
  getAccessToken(): Promise<string>;
  login(onStep?: (s: string) => void): Promise<void>;
  logout(): Promise<void>;
  subscribe(fn: () => void): () => void;
};

export function createSession(deps: {
  manager: Manager;
  // side-effecting login runner, injected for testability; wraps
  // loginWithLoopback({ manager, onStep }) in production.
  runLogin: (manager: Manager, onStep?: (s: string) => void) => Promise<void>;
}): Session {
  let authed = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const setAuthed = (v: boolean) => {
    if (v !== authed) {
      authed = v;
      emit();
    }
  };

  return {
    async bootstrap() {
      // getAccessToken refreshes an expired access token from the stored
      // refresh token; any failure (no token, refresh rejected) = logged out.
      try {
        await deps.manager.getAccessToken();
        setAuthed(true);
      } catch {
        setAuthed(false);
      }
    },
    isAuthenticated: () => authed,
    // Bare delegate: a mid-session refresh failure surfaces to the caller but
    // does NOT flip `authed` here — only bootstrap() maps a failure to logged-out.
    // Mid-session "401 → force logout" is the deferred data-layer policy (see spec §"Logout & 401").
    getAccessToken: () => deps.manager.getAccessToken(),
    async login(onStep) {
      await deps.runLogin(deps.manager, onStep);
      setAuthed(true);
    },
    async logout() {
      await deps.manager.clear();
      setAuthed(false);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
