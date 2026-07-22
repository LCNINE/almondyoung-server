import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider, useApiClient } from './ApiClientProvider';
import type { Session } from '../../core/auth/session';
import { apiBaseUrl } from '../../app/config';

const fetchMock = vi.fn(
  async (..._args: unknown[]) =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
);
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

const session: Session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};

function Probe() {
  const api = useApiClient();
  useEffect(() => {
    void api.request({ path: '/ping' });
  }, [api]);
  return <div>probe</div>;
}

describe('ApiClientProvider', () => {
  it('builds a client from the session and attaches the token', async () => {
    render(
      <SessionProvider session={session}>
        <ApiClientProvider>
          <Probe />
        </ApiClientProvider>
      </SessionProvider>
    );
    expect(screen.getByText('probe')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // apiBaseUrl varies per box (this box has a gitignored .env.local for
    // live Phase 1a testing); assert relative to it rather than hardcoding.
    expect(url).toBe(`${apiBaseUrl}/ping`);
    expect(init.headers).toMatchObject({ Cookie: 'accessToken=tok' });
  });

  it('throws when useApiClient is used outside the provider', () => {
    function Bare() {
      useApiClient();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ApiClientProvider/);
  });
});
