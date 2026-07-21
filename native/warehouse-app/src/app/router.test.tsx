import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
