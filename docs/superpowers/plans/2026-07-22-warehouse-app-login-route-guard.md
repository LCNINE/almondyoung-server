# Warehouse App — Login Screen + Route Guard (TanStack Router) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app an initial login screen and an authenticated area gated by a TanStack Router route guard, with silent session restore on launch and explicit logout.

**Architecture:** An app-global, framework-agnostic `Session` (over the existing token manager) owns authenticated state. A pre-mount splash runs `session.bootstrap()` once (silent auto-login). TanStack Router (code-based routes, memory history) gates a pathless `_authed` layout via `beforeLoad`; a public `/login` route bounces already-authenticated users. Presentational screens read the session from a React context; route `beforeLoad` guards read it from the router context (both fed the same instance).

**Tech Stack:** React 19 + TypeScript, `@tanstack/react-router` (new), `@tanstack/react-query` (existing), Vitest + Testing Library, Vite 8. No Rust changes.

## Global Constraints

- **Node** `>=22 <23` (local v22.23.1).
- **Standalone project** at `native/warehouse-app/`, own `package-lock.json`, imports no sibling app code. Run all `npm`/`npx` commands from `native/warehouse-app/`.
- **No `tauri` npm script** — use `npx tauri …`. **No `router` codegen/plugin** — routes are hand-written (code-based).
- **Router config:** memory history (`createMemoryHistory({ initialEntries: ['/'] })`); code-based route tree; single dependency added: `@tanstack/react-router`.
- **All backend HTTP** stays on `@tauri-apps/plugin-http` via the existing `login.ts` / `httpClient.ts` — this plan does not add HTTP calls.
- **Do not delete** the deep-link login path (`loginWithDeepLink`) — Android uses it later.
- **Type safety:** no `any` / `as` casting without justification; test stubs use `satisfies Session` (not `as`). Use only the `Profile` values `'station'`/`'handheld'`.
- **Commit** after every task. All commit messages end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Branch:** continue on `docs/warehouse-native-app-design`.
- **Design spec:** `docs/superpowers/specs/2026-07-22-warehouse-app-login-route-guard-design.md`.

---

## File Structure

```
native/warehouse-app/
├─ package.json / package-lock.json        # + @tanstack/react-router          (Task 2)
├─ src/
│  ├─ core/auth/
│  │  ├─ session.ts                         # NEW createSession + type Session  (Task 1)
│  │  └─ session.test.ts                    # NEW                               (Task 1)
│  ├─ app/
│  │  ├─ session-context.tsx                # NEW SessionProvider/useSession/useIsAuthenticated (Task 2)
│  │  ├─ session-context.test.tsx           # NEW                               (Task 2)
│  │  ├─ guards.ts                          # NEW requireAuth/requireAnon       (Task 2)
│  │  ├─ guards.test.ts                     # NEW                               (Task 2)
│  │  ├─ routeTree.tsx                       # NEW route tree                    (Task 5)
│  │  ├─ router.tsx                          # NEW createAppRouter + Register    (Task 5)
│  │  ├─ router.test.tsx                     # NEW guard integration test        (Task 5)
│  │  ├─ Bootstrap.tsx                       # NEW splash gate                   (Task 6)
│  │  ├─ Bootstrap.test.tsx                  # NEW                               (Task 6)
│  │  ├─ App.tsx                             # unchanged (still takes children)
│  │  └─ routes/
│  │     ├─ LoginScreen.tsx                  # NEW presentational login          (Task 3)
│  │     ├─ LoginScreen.test.tsx             # NEW                               (Task 3)
│  │     ├─ RootLayout.tsx                   # NEW <App><Outlet/></App>          (Task 5)
│  │     ├─ LoginRoute.tsx                   # NEW login route wrapper           (Task 5)
│  │     ├─ AuthedLayout.tsx                 # NEW authed layout + redirect fx   (Task 5)
│  │     ├─ ProfileHome.tsx                  # NEW index → Station/Handheld      (Task 5)
│  │     └─ DiagnosticsRoute.tsx             # NEW /diagnostics wrapper          (Task 5)
│  ├─ profiles/
│  │  ├─ shared/DiagnosticsScreen.tsx        # refactor: session-context + Logout (Task 4)
│  │  ├─ shared/DiagnosticsScreen.test.tsx   # update assertions                 (Task 4)
│  │  ├─ station/StationHome.tsx             # refactor: <Link> to /diagnostics  (Task 4)
│  │  └─ handheld/HandheldHome.tsx           # refactor: <Link> to /diagnostics  (Task 4)
│  └─ main.tsx                               # rewrite: session + Bootstrap + Router (Task 6)
```

**Task order rationale:** the session core (1) and its React/router adapters (2) come first; the login screen (3) and the component refactors (4) depend on the context; the route tree (5) wires the finished components; `main.tsx` + splash (6) makes the app whole and is verified end-to-end on-device. Between Task 4 and Task 6 the running app is intentionally incomplete (homes render `<Link>` with no router yet) — the **test suite stays green at every commit**, and the manual round-trip is Task 6.

---

## Task 1: `createSession` — app-global session core

**Files:**
- Create: `native/warehouse-app/src/core/auth/session.ts`
- Test: `native/warehouse-app/src/core/auth/session.test.ts`

**Interfaces:**
- Consumes: `ReturnType<typeof createTokenManager>` (`core/auth/tokenManager.ts`) — has `getAccessToken(): Promise<string>`, `set`, `clear(): Promise<void>`.
- Produces:
  - `type Session = { bootstrap(): Promise<void>; isAuthenticated(): boolean; getAccessToken(): Promise<string>; login(onStep?: (s: string) => void): Promise<void>; logout(): Promise<void>; subscribe(fn: () => void): () => void }`
  - `createSession(deps: { manager: ReturnType<typeof createTokenManager>; runLogin: (manager, onStep?) => Promise<void> }): Session`

- [ ] **Step 1: Write the failing tests**

Create `native/warehouse-app/src/core/auth/session.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createSession, type Session } from './session';
import type { createTokenManager } from './tokenManager';

type Manager = ReturnType<typeof createTokenManager>;

function fakeManager(over: Partial<Manager> = {}): Manager {
  return {
    getAccessToken: async () => 'A',
    set: async () => {},
    clear: async () => {},
    ...over,
  } satisfies Manager;
}

function make(over: {
  manager?: Partial<Manager>;
  runLogin?: (m: Manager, onStep?: (s: string) => void) => Promise<void>;
} = {}): Session {
  return createSession({
    manager: fakeManager(over.manager),
    runLogin: over.runLogin ?? (async () => {}),
  });
}

describe('createSession', () => {
  it('starts unauthenticated', () => {
    expect(make().isAuthenticated()).toBe(false);
  });

  it('bootstrap → authenticated when a token is available', async () => {
    const s = make({ manager: { getAccessToken: async () => 'A' } });
    await s.bootstrap();
    expect(s.isAuthenticated()).toBe(true);
  });

  it('bootstrap → unauthenticated when getAccessToken throws', async () => {
    const s = make({
      manager: {
        getAccessToken: async () => {
          throw new Error('not authenticated');
        },
      },
    });
    await s.bootstrap();
    expect(s.isAuthenticated()).toBe(false);
  });

  it('login runs runLogin then flips authenticated and notifies subscribers', async () => {
    const runLogin = vi.fn(async () => {});
    const s = make({ runLogin });
    const listener = vi.fn();
    s.subscribe(listener);
    await s.login();
    expect(runLogin).toHaveBeenCalledOnce();
    expect(s.isAuthenticated()).toBe(true);
    expect(listener).toHaveBeenCalled();
  });

  it('logout clears the manager and flips unauthenticated', async () => {
    const clear = vi.fn(async () => {});
    const s = make({ manager: { clear } });
    await s.login();
    const listener = vi.fn();
    s.subscribe(listener);
    await s.logout();
    expect(clear).toHaveBeenCalledOnce();
    expect(s.isAuthenticated()).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('subscribe returns an unsubscribe that stops notifications', async () => {
    const s = make();
    const listener = vi.fn();
    const off = s.subscribe(listener);
    off();
    await s.login();
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd native/warehouse-app && npx vitest run src/core/auth/session.test.ts 2>&1 | tail -20`
Expected: FAIL — `createSession` is not defined / module not found.

- [ ] **Step 3: Implement `createSession`**

Create `native/warehouse-app/src/core/auth/session.ts`:
```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd native/warehouse-app && npx vitest run src/core/auth/session.test.ts 2>&1 | tail -20`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app/src/core/auth/session.ts native/warehouse-app/src/core/auth/session.test.ts
git commit -m "feat(warehouse-app): app-global Session core (bootstrap/login/logout/subscribe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Router dependency + React/router auth adapters (context + guards)

**Files:**
- Modify: `native/warehouse-app/package.json`, `native/warehouse-app/package-lock.json` (via `npm install`)
- Create: `native/warehouse-app/src/app/session-context.tsx`
- Create: `native/warehouse-app/src/app/session-context.test.tsx`
- Create: `native/warehouse-app/src/app/guards.ts`
- Create: `native/warehouse-app/src/app/guards.test.ts`

**Interfaces:**
- Consumes: `type Session` (Task 1); `redirect`, `isRedirect` (`@tanstack/react-router`).
- Produces:
  - `SessionProvider({ session: Session; children }): JSX.Element`
  - `useSession(): Session`
  - `useIsAuthenticated(): boolean`
  - `requireAuth(session: { isAuthenticated(): boolean }): void` (throws `redirect({ to: '/login' })`)
  - `requireAnon(session: { isAuthenticated(): boolean }): void` (throws `redirect({ to: '/' })`)

- [ ] **Step 1: Install the router dependency**

Run: `cd native/warehouse-app && npm install @tanstack/react-router`
Expected: adds `@tanstack/react-router` to `dependencies` and updates `package-lock.json`. (Do NOT add `@tanstack/router-plugin` or devtools.)

- [ ] **Step 2: Write the failing guard tests**

Create `native/warehouse-app/src/app/guards.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isRedirect } from '@tanstack/react-router';
import { requireAuth, requireAnon } from './guards';

const stub = (v: boolean) => ({ isAuthenticated: () => v });

describe('requireAuth', () => {
  it('redirects to /login when unauthenticated', () => {
    try {
      requireAuth(stub(false));
      throw new Error('did not throw');
    } catch (e) {
      expect(isRedirect(e)).toBe(true);
      if (isRedirect(e)) expect(e.to).toBe('/login');
    }
  });

  it('does not throw when authenticated', () => {
    expect(() => requireAuth(stub(true))).not.toThrow();
  });
});

describe('requireAnon', () => {
  it('redirects to / when authenticated', () => {
    try {
      requireAnon(stub(true));
      throw new Error('did not throw');
    } catch (e) {
      expect(isRedirect(e)).toBe(true);
      if (isRedirect(e)) expect(e.to).toBe('/');
    }
  });

  it('does not throw when unauthenticated', () => {
    expect(() => requireAnon(stub(false))).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the guard tests to verify they fail**

Run: `cd native/warehouse-app && npx vitest run src/app/guards.test.ts 2>&1 | tail -20`
Expected: FAIL — `./guards` module not found.

- [ ] **Step 4: Implement the guards**

Create `native/warehouse-app/src/app/guards.ts`:
```ts
import { redirect } from '@tanstack/react-router';

type SessionLike = { isAuthenticated(): boolean };

/** Route guard for the authenticated area: bounce anonymous users to /login. */
export function requireAuth(session: SessionLike): void {
  if (!session.isAuthenticated()) throw redirect({ to: '/login' });
}

/** Reverse guard for /login: send already-authenticated users to the home. */
export function requireAnon(session: SessionLike): void {
  if (session.isAuthenticated()) throw redirect({ to: '/' });
}
```

- [ ] **Step 5: Run the guard tests to verify they pass**

Run: `cd native/warehouse-app && npx vitest run src/app/guards.test.ts 2>&1 | tail -20`
Expected: PASS (4 tests). If the thrown redirect exposes its target as `e.options.to` rather than `e.to`, adjust the two `expect(e.to)` lines to `expect(e.options.to)` and re-run.

- [ ] **Step 6: Write the failing session-context test**

Create `native/warehouse-app/src/app/session-context.test.tsx`:
```tsx
import { describe, it, expect, act } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionProvider, useIsAuthenticated } from './session-context';
import type { Session } from '../core/auth/session';

function makeStub() {
  let authed = false;
  const ls = new Set<() => void>();
  const session: Session = {
    bootstrap: async () => {},
    isAuthenticated: () => authed,
    getAccessToken: async () => 'tok',
    login: async () => {},
    logout: async () => {},
    subscribe: (fn: () => void) => {
      ls.add(fn);
      return () => {
        ls.delete(fn);
      };
    },
  } satisfies Session;
  return {
    session,
    setAuthed: (v: boolean) => {
      authed = v;
      ls.forEach((l) => l());
    },
  };
}

function Probe() {
  return <span>{useIsAuthenticated() ? 'yes' : 'no'}</span>;
}

describe('useIsAuthenticated', () => {
  it('reflects session state and re-renders on change', () => {
    const { session, setAuthed } = makeStub();
    render(
      <SessionProvider session={session}>
        <Probe />
      </SessionProvider>
    );
    expect(screen.getByText('no')).toBeInTheDocument();
    act(() => setAuthed(true));
    expect(screen.getByText('yes')).toBeInTheDocument();
  });
});
```

Note: `act` is imported from `vitest`'s re-export path only if available; if the import errors, replace the first import line with:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
```

- [ ] **Step 7: Run the context test to verify it fails**

Run: `cd native/warehouse-app && npx vitest run src/app/session-context.test.tsx 2>&1 | tail -20`
Expected: FAIL — `./session-context` module not found.

- [ ] **Step 8: Implement the session context**

Create `native/warehouse-app/src/app/session-context.tsx`:
```tsx
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
```

- [ ] **Step 9: Run the context test to verify it passes**

Run: `cd native/warehouse-app && npx vitest run src/app/session-context.test.tsx 2>&1 | tail -20`
Expected: PASS (1 test).

- [ ] **Step 10: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app/package.json native/warehouse-app/package-lock.json native/warehouse-app/src/app/session-context.tsx native/warehouse-app/src/app/session-context.test.tsx native/warehouse-app/src/app/guards.ts native/warehouse-app/src/app/guards.test.ts
git commit -m "feat(warehouse-app): TanStack Router dep + session context + route guards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `LoginScreen` — presentational login trigger

**Files:**
- Create: `native/warehouse-app/src/app/routes/LoginScreen.tsx`
- Test: `native/warehouse-app/src/app/routes/LoginScreen.test.tsx`

**Interfaces:**
- Consumes: `useSession` (Task 2); `Button` (`core/design/Button`).
- Produces: `LoginScreen(): JSX.Element` — a `Login` button that calls `session.login(setStatus)` and renders progress/error text.

- [ ] **Step 1: Write the failing tests**

Create `native/warehouse-app/src/app/routes/LoginScreen.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionProvider } from '../session-context';
import { LoginScreen } from './LoginScreen';
import type { Session } from '../../core/auth/session';

function stubSession(over: Partial<Session> = {}): Session {
  return {
    bootstrap: async () => {},
    isAuthenticated: () => false,
    getAccessToken: async () => 'tok',
    login: async () => {},
    logout: async () => {},
    subscribe: () => () => {},
    ...over,
  } satisfies Session;
}

describe('LoginScreen', () => {
  it('renders the Login button', () => {
    render(
      <SessionProvider session={stubSession()}>
        <LoginScreen />
      </SessionProvider>
    );
    expect(
      screen.getByRole('button', { name: /^login$/i })
    ).toBeInTheDocument();
  });

  it('calls session.login on click', async () => {
    const login = vi.fn(async () => {});
    render(
      <SessionProvider session={stubSession({ login })}>
        <LoginScreen />
      </SessionProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: /^login$/i }));
    expect(login).toHaveBeenCalledOnce();
  });

  it('shows an error when login rejects', async () => {
    const login = vi.fn(async () => {
      throw new Error('boom');
    });
    render(
      <SessionProvider session={stubSession({ login })}>
        <LoginScreen />
      </SessionProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: /^login$/i }));
    expect(await screen.findByText(/login error: .*boom/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd native/warehouse-app && npx vitest run src/app/routes/LoginScreen.test.tsx 2>&1 | tail -20`
Expected: FAIL — `./LoginScreen` module not found.

- [ ] **Step 3: Implement `LoginScreen`**

Create `native/warehouse-app/src/app/routes/LoginScreen.tsx`:
```tsx
import { useState } from 'react';
import { Button } from '../../core/design/Button';
import { useSession } from '../session-context';

export function LoginScreen() {
  const session = useSession();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function onLogin() {
    setBusy(true);
    setStatus('logging in…');
    try {
      await session.login(setStatus);
      setStatus('logged in');
    } catch (e) {
      setStatus(`login error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-24 flex max-w-xs flex-col items-center gap-4">
      <h1 className="text-2xl font-semibold">Almond WMS</h1>
      <p className="text-sm text-gray-600">물류 작업자 로그인</p>
      <Button className="w-full" disabled={busy} onClick={onLogin}>
        Login
      </Button>
      {status && <p className="text-sm text-gray-600">{status}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd native/warehouse-app && npx vitest run src/app/routes/LoginScreen.test.tsx 2>&1 | tail -20`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app/src/app/routes/LoginScreen.tsx native/warehouse-app/src/app/routes/LoginScreen.test.tsx
git commit -m "feat(warehouse-app): LoginScreen (login trigger + progress/error)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Refactor `DiagnosticsScreen` + profile homes for the router

**Files:**
- Modify: `native/warehouse-app/src/profiles/shared/DiagnosticsScreen.tsx`
- Modify: `native/warehouse-app/src/profiles/shared/DiagnosticsScreen.test.tsx`
- Modify: `native/warehouse-app/src/profiles/station/StationHome.tsx`
- Modify: `native/warehouse-app/src/profiles/handheld/HandheldHome.tsx`

**Interfaces:**
- Consumes: `useSession`, `useIsAuthenticated` (Task 2); `Link` (`@tanstack/react-router`).
- Produces: a `DiagnosticsScreen` with no self-contained login (session comes from context; adds a `Logout` button + auth status); `StationHome`/`HandheldHome` that link to `/diagnostics` instead of a local toggle.

- [ ] **Step 1: Update the DiagnosticsScreen test (session provider + Logout, no Login)**

Replace the entire contents of `native/warehouse-app/src/profiles/shared/DiagnosticsScreen.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { SessionProvider } from '../../app/session-context';
import { DiagnosticsScreen } from './DiagnosticsScreen';
import type { Session } from '../../core/auth/session';

const stub: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

describe('DiagnosticsScreen', () => {
  it('mounts and shows the diagnostics sections + logout', () => {
    render(
      <SessionProvider session={stub}>
        <ScanProvider>
          <DiagnosticsScreen />
        </ScanProvider>
      </SessionProvider>
    );
    expect(screen.getByText('Diagnostics')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /camera scan/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /test print/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^logout$/i })
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd native/warehouse-app && npx vitest run src/profiles/shared/DiagnosticsScreen.test.tsx 2>&1 | tail -20`
Expected: FAIL — no Logout button (the screen still renders the old Login section and doesn't read a SessionProvider).

- [ ] **Step 3: Refactor `DiagnosticsScreen`**

Replace the entire contents of `native/warehouse-app/src/profiles/shared/DiagnosticsScreen.tsx`:
```tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../../core/design/Button';
import { useScanner, useScanEmit } from '../../core/hardware/scan/useScanner';
import { scanWithCamera } from '../../core/hardware/scan/camera';
import { renderTestLabel } from '../../core/hardware/print/zpl';
import type { ScanEvent } from '../../core/hardware/scan/ScanProvider';
import { useSession, useIsAuthenticated } from '../../app/session-context';

export function DiagnosticsScreen() {
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [status, setStatus] = useState('');
  const emit = useScanEmit();
  const session = useSession();
  const authed = useIsAuthenticated();
  useScanner((e) => setScans((s) => [e, ...s].slice(0, 20)));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Diagnostics</h1>

      <section>
        <h2 className="font-medium">Scans (HID + camera)</h2>
        <ul className="mt-1 max-h-40 overflow-auto text-sm">
          {scans.map((s, i) => (
            <li key={i}>
              [{s.source}] {s.code}
            </li>
          ))}
        </ul>
        <Button
          className="mt-2"
          onClick={() =>
            scanWithCamera(emit).catch((e) => setStatus(String(e)))
          }
        >
          Camera scan
        </Button>
      </section>

      <section>
        <h2 className="font-medium">Printer</h2>
        <Button
          onClick={async () => {
            const zpl = renderTestLabel({
              title: 'ALMOND WMS',
              barcode: '8801234',
            });
            const target =
              prompt('Printer target', 'tcp://192.168.0.100:9100') ?? '';
            try {
              await invoke('print_raw', {
                target,
                data: Array.from(new TextEncoder().encode(zpl)),
              });
              setStatus('printed');
            } catch (e) {
              setStatus(`print error: ${e}`);
            }
          }}
        >
          Test print
        </Button>
      </section>

      <section>
        <h2 className="font-medium">Auth</h2>
        <p className="text-sm">
          {authed ? 'authenticated' : 'not authenticated'}
        </p>
        <Button className="mt-2" onClick={() => session.logout()}>
          Logout
        </Button>
      </section>

      <p className="text-sm text-gray-600">{status}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd native/warehouse-app && npx vitest run src/profiles/shared/DiagnosticsScreen.test.tsx 2>&1 | tail -20`
Expected: PASS (1 test).

- [ ] **Step 5: Refactor `StationHome` to link to `/diagnostics`**

Replace the entire contents of `native/warehouse-app/src/profiles/station/StationHome.tsx`:
```tsx
import { Link } from '@tanstack/react-router';
import { Button } from '../../core/design/Button';

export function StationHome() {
  return (
    <div data-testid="station-home" className="space-y-4">
      <p>Station profile</p>
      <Link to="/diagnostics">
        <Button>Diagnostics</Button>
      </Link>
    </div>
  );
}
```

- [ ] **Step 6: Refactor `HandheldHome` to link to `/diagnostics`**

Replace the entire contents of `native/warehouse-app/src/profiles/handheld/HandheldHome.tsx`:
```tsx
import { Link } from '@tanstack/react-router';
import { Button } from '../../core/design/Button';

export function HandheldHome() {
  return (
    <div data-testid="handheld-home" className="space-y-4">
      <p>Handheld profile</p>
      <Link to="/diagnostics">
        <Button>Diagnostics</Button>
      </Link>
    </div>
  );
}
```

- [ ] **Step 7: Type-check and run the full suite**

Run: `cd native/warehouse-app && npx tsc -b 2>&1 | tail -5 && echo "tsc: $?" && npx vitest run 2>&1 | tail -8`
Expected: `tsc: 0`; all Vitest tests pass. (`<Link to="/diagnostics">` type-checks as a loose string here — the typed route registration arrives in Task 5.)

- [ ] **Step 8: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app/src/profiles
git commit -m "refactor(warehouse-app): Diagnostics reads shared session + Logout; homes link to /diagnostics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Route tree + router factory + guard integration test

**Files:**
- Create: `native/warehouse-app/src/app/routes/RootLayout.tsx`
- Create: `native/warehouse-app/src/app/routes/LoginRoute.tsx`
- Create: `native/warehouse-app/src/app/routes/AuthedLayout.tsx`
- Create: `native/warehouse-app/src/app/routes/ProfileHome.tsx`
- Create: `native/warehouse-app/src/app/routes/DiagnosticsRoute.tsx`
- Create: `native/warehouse-app/src/app/routeTree.tsx`
- Create: `native/warehouse-app/src/app/router.tsx`
- Test: `native/warehouse-app/src/app/router.test.tsx`

**Interfaces:**
- Consumes: `App` (`app/App`); `Outlet`, `useNavigate`, `createRootRouteWithContext`, `createRoute`, `createRouter`, `createMemoryHistory`, `RouterProvider` (`@tanstack/react-router`); `requireAuth`/`requireAnon` (Task 2); `useIsAuthenticated` (Task 2); `LoginScreen` (Task 3); `DiagnosticsScreen`, `StationHome`, `HandheldHome` (Task 4); `resolveProfile` (`app/profile`); `platform` (`@tauri-apps/plugin-os`); `type Session` (Task 1).
- Produces: `createAppRouter(session: Session)` and `type AppRouter`; the `@tanstack/react-router` `Register` augmentation so `Link`/`navigate` are typed against the real routes.

- [ ] **Step 1: Create the root layout**

Create `native/warehouse-app/src/app/routes/RootLayout.tsx`:
```tsx
import { Outlet } from '@tanstack/react-router';
import { App } from '../App';

export function RootLayout() {
  return (
    <App>
      <Outlet />
    </App>
  );
}
```

- [ ] **Step 2: Create the login route wrapper (redirect home once authenticated)**

Create `native/warehouse-app/src/app/routes/LoginRoute.tsx`:
```tsx
import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useIsAuthenticated } from '../session-context';
import { LoginScreen } from './LoginScreen';

export function LoginRoute() {
  const authed = useIsAuthenticated();
  const navigate = useNavigate();
  useEffect(() => {
    if (authed) navigate({ to: '/' });
  }, [authed, navigate]);
  return <LoginScreen />;
}
```

- [ ] **Step 3: Create the authenticated layout (redirect to login on logout)**

Create `native/warehouse-app/src/app/routes/AuthedLayout.tsx`:
```tsx
import { useEffect } from 'react';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useIsAuthenticated } from '../session-context';

export function AuthedLayout() {
  const authed = useIsAuthenticated();
  const navigate = useNavigate();
  // beforeLoad gates entry; this effect handles a live logout / refresh
  // failure while an authenticated screen is already mounted.
  useEffect(() => {
    if (!authed) navigate({ to: '/login' });
  }, [authed, navigate]);
  return <Outlet />;
}
```

- [ ] **Step 4: Create the profile home (index) and diagnostics route components**

Create `native/warehouse-app/src/app/routes/ProfileHome.tsx`:
```tsx
import { platform } from '@tauri-apps/plugin-os';
import { resolveProfile } from '../profile';
import { StationHome } from '../../profiles/station/StationHome';
import { HandheldHome } from '../../profiles/handheld/HandheldHome';

export function ProfileHome() {
  return resolveProfile(platform()) === 'station' ? (
    <StationHome />
  ) : (
    <HandheldHome />
  );
}
```

Create `native/warehouse-app/src/app/routes/DiagnosticsRoute.tsx`:
```tsx
import { DiagnosticsScreen } from '../../profiles/shared/DiagnosticsScreen';

export function DiagnosticsRoute() {
  return <DiagnosticsScreen />;
}
```

- [ ] **Step 5: Create the route tree**

Create `native/warehouse-app/src/app/routeTree.tsx`:
```tsx
import { createRootRouteWithContext, createRoute } from '@tanstack/react-router';
import type { Session } from '../core/auth/session';
import { requireAuth, requireAnon } from './guards';
import { RootLayout } from './routes/RootLayout';
import { LoginRoute } from './routes/LoginRoute';
import { AuthedLayout } from './routes/AuthedLayout';
import { ProfileHome } from './routes/ProfileHome';
import { DiagnosticsRoute } from './routes/DiagnosticsRoute';

export interface RouterContext {
  session: Session;
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: ({ context }) => requireAnon(context.session),
  component: LoginRoute,
});

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authed',
  beforeLoad: ({ context }) => requireAuth(context.session),
  component: AuthedLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: ProfileHome,
});

const diagnosticsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/diagnostics',
  component: DiagnosticsRoute,
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authedRoute.addChildren([indexRoute, diagnosticsRoute]),
]);
```

- [ ] **Step 6: Create the router factory + type registration**

Create `native/warehouse-app/src/app/router.tsx`:
```tsx
import { createRouter, createMemoryHistory } from '@tanstack/react-router';
import type { Session } from '../core/auth/session';
import { routeTree } from './routeTree';

export function createAppRouter(session: Session) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { session },
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
```

- [ ] **Step 7: Write the guard integration test**

Create `native/warehouse-app/src/app/router.test.tsx`:
```tsx
import { describe, it, expect, vi, act } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { SessionProvider } from './session-context';
import { createAppRouter } from './router';
import type { Session } from '../core/auth/session';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));

function makeStub() {
  let authed = false;
  const ls = new Set<() => void>();
  const session: Session = {
    bootstrap: async () => {},
    isAuthenticated: () => authed,
    getAccessToken: async () => 'tok',
    login: async () => {
      authed = true;
      ls.forEach((l) => l());
    },
    logout: async () => {
      authed = false;
      ls.forEach((l) => l());
    },
    subscribe: (fn: () => void) => {
      ls.add(fn);
      return () => {
        ls.delete(fn);
      };
    },
  } satisfies Session;
  return {
    session,
    setAuthed: (v: boolean) => {
      authed = v;
      ls.forEach((l) => l());
    },
  };
}

function renderApp(session: Session) {
  return render(
    <SessionProvider session={session}>
      <RouterProvider router={createAppRouter(session)} />
    </SessionProvider>
  );
}

describe('router guard integration', () => {
  it('sends an unauthenticated user to the login screen', async () => {
    const { session } = makeStub();
    renderApp(session);
    expect(
      await screen.findByRole('button', { name: /^login$/i })
    ).toBeInTheDocument();
  });

  it('shows the profile home to an authenticated user', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    renderApp(session);
    expect(await screen.findByText('Station profile')).toBeInTheDocument();
  });

  it('redirects to login when the session logs out', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    renderApp(session);
    expect(await screen.findByText('Station profile')).toBeInTheDocument();
    await act(async () => {
      setAuthed(false);
    });
    expect(
      await screen.findByRole('button', { name: /^login$/i })
    ).toBeInTheDocument();
  });
});
```

Note: if `act` is not exported from `vitest` in this version, change the first two import lines to:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
```

- [ ] **Step 8: Run the integration test to verify it passes**

Run: `cd native/warehouse-app && npx vitest run src/app/router.test.tsx 2>&1 | tail -25`
Expected: PASS (3 tests). If an assertion times out, confirm the `@tauri-apps/plugin-os` mock is applied and that the redirect settles (the tests already use `findBy*`, which awaits).

- [ ] **Step 9: Type-check and run the full suite**

Run: `cd native/warehouse-app && npx tsc -b 2>&1 | tail -5 && echo "tsc: $?" && npx vitest run 2>&1 | tail -8`
Expected: `tsc: 0`; all Vitest tests pass. `<Link to="/diagnostics">` in the homes now type-checks against the registered routes.

- [ ] **Step 10: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app/src/app/routes/RootLayout.tsx native/warehouse-app/src/app/routes/LoginRoute.tsx native/warehouse-app/src/app/routes/AuthedLayout.tsx native/warehouse-app/src/app/routes/ProfileHome.tsx native/warehouse-app/src/app/routes/DiagnosticsRoute.tsx native/warehouse-app/src/app/routeTree.tsx native/warehouse-app/src/app/router.tsx native/warehouse-app/src/app/router.test.tsx
git commit -m "feat(warehouse-app): TanStack Router route tree + auth guard + integration test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Splash bootstrap + `main.tsx` wiring + end-to-end verification

**Files:**
- Create: `native/warehouse-app/src/app/Bootstrap.tsx`
- Test: `native/warehouse-app/src/app/Bootstrap.test.tsx`
- Modify: `native/warehouse-app/src/main.tsx`

**Interfaces:**
- Consumes: `type Session` (Task 1); `createSession` (Task 1); `createTokenManager` (`core/auth/tokenManager`); `createStrongholdTokenStore` (`core/auth/tokenStore`); `loginWithLoopback`, `refreshTokens`, `discoverEndpoints` (`core/auth/login`); `createAppRouter` (Task 5); `SessionProvider` (Task 2); `queryClient` (`core/data/queryClient`); `ScanProvider` (`core/hardware/scan/ScanProvider`); `RouterProvider` (`@tanstack/react-router`).
- Produces: `Bootstrap({ session, children })` — runs `session.bootstrap()` once and shows a splash until it resolves; a `main.tsx` that assembles the real session and mounts the router.

- [ ] **Step 1: Write the failing Bootstrap test**

Create `native/warehouse-app/src/app/Bootstrap.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Bootstrap } from './Bootstrap';
import type { Session } from '../core/auth/session';

function stub(bootstrap: () => Promise<void>): Session {
  return {
    bootstrap,
    isAuthenticated: () => false,
    getAccessToken: async () => 'tok',
    login: async () => {},
    logout: async () => {},
    subscribe: () => () => {},
  } satisfies Session;
}

describe('Bootstrap', () => {
  it('shows a splash, then renders children once bootstrap resolves', async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    render(
      <Bootstrap session={stub(() => gate)}>
        <div>ready-content</div>
      </Bootstrap>
    );
    expect(screen.getByText(/almond wms/i)).toBeInTheDocument();
    expect(screen.queryByText('ready-content')).not.toBeInTheDocument();
    resolve();
    expect(await screen.findByText('ready-content')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd native/warehouse-app && npx vitest run src/app/Bootstrap.test.tsx 2>&1 | tail -20`
Expected: FAIL — `./Bootstrap` module not found.

- [ ] **Step 3: Implement `Bootstrap`**

Create `native/warehouse-app/src/app/Bootstrap.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { Session } from '../core/auth/session';

/** Runs the one-time silent session restore behind a splash before children
 * (the router) mount, so route guards read a settled auth state. */
export function Bootstrap({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    session.bootstrap().finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [session]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Almond WMS…
      </div>
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd native/warehouse-app && npx vitest run src/app/Bootstrap.test.tsx 2>&1 | tail -20`
Expected: PASS (1 test).

- [ ] **Step 5: Rewrite `main.tsx` to assemble the session and mount the router**

Replace the entire contents of `native/warehouse-app/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import './index.css';
import { queryClient } from './core/data/queryClient';
import { ScanProvider } from './core/hardware/scan/ScanProvider';
import { SessionProvider } from './app/session-context';
import { Bootstrap } from './app/Bootstrap';
import { createSession } from './core/auth/session';
import { createTokenManager } from './core/auth/tokenManager';
import { createStrongholdTokenStore } from './core/auth/tokenStore';
import {
  loginWithLoopback,
  refreshTokens,
  discoverEndpoints,
} from './core/auth/login';
import { createAppRouter } from './app/router';

const store = createStrongholdTokenStore();
const manager = createTokenManager({
  store,
  refresh: async (refreshToken) => {
    const eps = await discoverEndpoints();
    return refreshTokens({ tokenEndpoint: eps.token_endpoint, refreshToken });
  },
});
const session = createSession({
  manager,
  runLogin: (m, onStep) => loginWithLoopback({ manager: m, onStep }),
});
const router = createAppRouter(session);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>
        <ScanProvider>
          <Bootstrap session={session}>
            <RouterProvider router={router} />
          </Bootstrap>
        </ScanProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>
);
```

- [ ] **Step 6: Full verification — suite, type-check, lint, build**

Run: `cd native/warehouse-app && npx vitest run 2>&1 | tail -10 && npx tsc -b 2>&1 | tail -5 && echo "tsc: $?" && npx oxlint 2>&1 | tail -8 && npx vite build 2>&1 | tail -5`
Expected: all Vitest tests pass; `tsc: 0`; oxlint reports no errors on the new/changed files; `vite build` succeeds.

- [ ] **Step 7: Commit**

```bash
cd /home/pauseb/workspace/almondyoung-server
git add native/warehouse-app/src/app/Bootstrap.tsx native/warehouse-app/src/app/Bootstrap.test.tsx native/warehouse-app/src/main.tsx
git commit -m "feat(warehouse-app): splash bootstrap + wire session/router into main

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Manual end-to-end verification on the dev box** [manual on-device]

Run: `. "$HOME/.cargo/env" && cd native/warehouse-app && npx tauri dev`

Then verify the full guard behavior:
1. **Cold start, no session** — the app opens on the **login screen** (not a profile home). *(If a session persists from earlier login testing, log out first via Diagnostics, or clear the stronghold vault file under the app data dir, then relaunch.)*
2. **Login** — click Login → the system browser opens auth-web → complete a real login → the app lands on the **profile home** (Station on this Windows-less linux box resolves to Handheld — expect "Handheld profile").
3. **Reach Diagnostics** — from the home, click **Diagnostics** → the `/diagnostics` screen shows, with an `authenticated` status line.
4. **Silent auto-login** — fully quit and relaunch `npx tauri dev` → the app lands on the **profile home without** re-entering credentials (the splash appears briefly during bootstrap).
5. **Logout** — on Diagnostics click **Logout** → the app returns to the **login screen**.

Expected: every transition behaves as above. Record any failure as a bug before considering the feature complete.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Routing tech (code-based, memory history, single dep) → Task 2 (install) + Task 5 (router factory).
- App-global framework-agnostic session (`createSession`, bootstrap/isAuthenticated/getAccessToken/login/logout/subscribe) → Task 1.
- React context + router context wiring → Task 2 (context) + Task 5 (router context).
- Route tree (`/login`, `_authed` guard, index profile home, `/diagnostics`) → Task 5.
- `beforeLoad` guard + reverse guard on `/login` → Task 2 (guards) + Task 5 (wiring).
- Splash bootstrap before router mount → Task 6.
- Login screen (trigger + progress/error) → Task 3.
- Logout button + auth status; absorb ad-hoc login out of Diagnostics → Task 4.
- 401/session-invalidation redirect (refresh failure → unauthenticated → guard) → covered by session `bootstrap`/`getAccessToken` behavior (Task 1) + AuthedLayout redirect effect (Task 5); the "API 401 with valid token surfaces as error, no forced logout" policy needs no new code (existing `httpClient` throws; screens show the error).
- Testing (session unit, guard unit, LoginScreen, integration, Bootstrap) → Tasks 1, 2, 3, 5, 6.
- Out-of-scope items (Phase 1–4 screens, Android back, end_session, global 401 policy, device-derived key) → not implemented, consistent with the spec.

**Placeholder scan:** no TBD/TODO; every code step contains complete source; the two `act`-import notes and the `e.options.to` fallback note are concrete conditional instructions, not placeholders; the `<ADMIN…>`-style tokens do not appear (no backend steps in this plan).

**Type consistency:** `Session` shape is identical across every stub (`bootstrap/isAuthenticated/getAccessToken/login/logout/subscribe`) and matches Task 1's definition; `createSession({ manager, runLogin })` matches its call in `main.tsx`; `runLogin: (m, onStep) => loginWithLoopback({ manager: m, onStep })` matches the existing `loginWithLoopback(deps: { manager, onStep? })`; `createAppRouter(session)` / `RouterContext.session` / `requireAuth(context.session)` all agree; `useIsAuthenticated()` / `useSession()` names are stable across Tasks 2–6; route paths `'/login'`, `'/'`, `'/diagnostics'` are consistent between guards, route tree, homes, and tests.
