import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
