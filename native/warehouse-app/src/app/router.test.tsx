import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from '@tanstack/react-router';
import { SessionProvider } from './session-context';
import { ScanProvider } from '../core/hardware/scan/ScanProvider';
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
        <ScanProvider>
          <RouterProvider router={createAppRouter(session)} />
        </ScanProvider>
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
});
