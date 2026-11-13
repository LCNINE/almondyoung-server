import type { createTokenManager } from './tokenManager';
import type { WorkerIdentity } from './oidc';

type Manager = ReturnType<typeof createTokenManager>;

export type Session = {
  /** Restore a persisted session once at startup (silent auto-login). */
  bootstrap(): Promise<void>;
  /** Synchronous — read by the router guard. */
  isAuthenticated(): boolean;
  getAccessToken(): Promise<string>;
  login(onStep?: (s: string) => void): Promise<void>;
  logout(): Promise<void>;
  /** Also ends the browser sign-in so the next login can pick another account. */
  signOut?(): Promise<void>;
  /** The signed-in worker, fetched once per login. */
  identity?(): Promise<WorkerIdentity>;
  subscribe(fn: () => void): () => void;
};

export function createSession(deps: {
  manager: Manager;
  // side-effecting login runner, injected for testability; wraps
  // loginWithLoopback({ manager, onStep }) in production.
  runLogin: (manager: Manager, onStep?: (s: string) => void) => Promise<void>;
  endBrowserSession?: (idToken?: string) => Promise<void>;
  fetchIdentity?: (accessToken: string) => Promise<WorkerIdentity>;
}): Session {
  let authed = false;
  // 로그인이 바뀌면 세대가 올라가 앞 계정의 응답을 다시 쓰지 않는다
  let generation = 0;
  let identity:
    { generation: number; promise: Promise<WorkerIdentity> } | undefined;
  const fetchIdentity = deps.fetchIdentity;
  const forgetIdentity = () => {
    generation += 1;
    identity = undefined;
  };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const setAuthed = (v: boolean) => {
    if (v !== authed) {
      forgetIdentity();
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
      forgetIdentity();
      await deps.runLogin(deps.manager, onStep);
      setAuthed(true);
    },
    async logout() {
      await deps.manager.clear();
      setAuthed(false);
    },
    async signOut() {
      const idToken = await deps.manager.getIdToken().catch(() => undefined);

      await deps.endBrowserSession?.(idToken);
      await deps.manager.clear();
      setAuthed(false);
    },
    ...(fetchIdentity && {
      identity() {
        if (identity?.generation === generation) return identity.promise;
        const promise = deps.manager
          .getAccessToken()
          .then(fetchIdentity)
          .then((found) => {
            // 다시 확인한 화면 말고 이미 실패를 그린 다른 화면도 다시 읽게 알린다
            if (identity?.promise === promise) emit();
            return found;
          })
          .catch((error: unknown) => {
            if (identity?.promise === promise) identity = undefined;
            throw error;
          });
        identity = { generation, promise };
        return promise;
      },
    }),
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
