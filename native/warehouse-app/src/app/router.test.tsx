import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createRouter, createMemoryHistory } from '@tanstack/react-router';
import { SessionProvider } from './session-context';
import { WarehouseProvider } from './warehouse-context';
import { createMemoryPrefs } from '../core/data/devicePrefs';
import { ScanProvider } from '../core/hardware/scan/ScanProvider';
import { createAppRouter } from './router';
import { routeTree } from './routeTree';
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
  return renderAppRouter(['/'], session);
}

/**
 * `createAppRouter` hardcodes the initial entry to '/' — tests that need to
 * land on a different starting path (e.g. redirect checks) build the router
 * directly from `routeTree` instead, with the same providers `renderApp`
 * wires up. Returns the router so callers can assert on `state.location`.
 */
function renderAppRouter(initialEntries: string[], session: Session) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
    context: { session },
  });
  render(
    <SessionProvider session={session}>
      <WarehouseProvider prefs={createMemoryPrefs()}>
        <RouterProvider router={router} />
      </WarehouseProvider>
    </SessionProvider>
  );
  return router;
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
    expect(
      await screen.findByRole('link', { name: /재고조회/ })
    ).toBeInTheDocument();
  });

  it('redirects to login when the session logs out', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    renderApp(session);
    expect(
      await screen.findByRole('link', { name: /재고조회/ })
    ).toBeInTheDocument();
    await act(async () => {
      setAuthed(false);
    });
    expect(
      await screen.findByRole('button', { name: /^login$/i })
    ).toBeInTheDocument();
  });

  it('closes the diagnostics dead-end: home -> diagnostics -> home', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    const user = userEvent.setup();
    // DiagnosticsScreen calls useScanner(), which requires a ScanProvider in
    // the tree — renderApp() above doesn't include one, so this case renders
    // locally instead of reusing that helper.
    render(
      <SessionProvider session={session}>
        <WarehouseProvider prefs={createMemoryPrefs()}>
          <ScanProvider>
            <RouterProvider router={createAppRouter(session)} />
          </ScanProvider>
        </WarehouseProvider>
      </SessionProvider>
    );

    expect(
      await screen.findByRole('link', { name: /재고조회/ })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /진단/ }));

    expect(
      await screen.findByRole('heading', { name: /diagnostics/i })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: /home/i })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /home/i }));

    expect(
      await screen.findByRole('link', { name: /재고조회/ })
    ).toBeInTheDocument();
  });

  it('/picking 과 /packing 은 /outbound 로 보낸다', async () => {
    const { session, setAuthed } = makeStub();
    setAuthed(true);
    const router = renderAppRouter(['/picking'], session);
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound'));
  });
});
