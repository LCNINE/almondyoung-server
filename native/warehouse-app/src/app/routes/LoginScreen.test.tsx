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
