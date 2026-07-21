import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          access_token: 'A',
          refresh_token: 'R',
          id_token: 'I',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
  ),
}));

import { fetch } from '@tauri-apps/plugin-http';
import { exchangeCode, refreshTokens } from './login';

beforeEach(() => {
  vi.mocked(fetch).mockClear();
});

describe('exchangeCode', () => {
  it('sends the given redirect_uri and maps the token response', async () => {
    const t0 = 1_000_000;
    const set = await exchangeCode({
      tokenEndpoint: 'https://a/token',
      code: 'CODE',
      verifier: 'V',
      redirectUri: 'http://127.0.0.1:5000/callback',
      now: () => t0,
    });
    expect(set.accessToken).toBe('A');
    expect(set.refreshToken).toBe('R');
    expect(set.expiresAt).toBe(t0 + 3600 * 1000);

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://a/token');
    expect(call[1]?.method).toBe('POST');
    expect(String(call[1]?.body)).toContain('grant_type=authorization_code');
    expect(String(call[1]?.body)).toContain('code=CODE');
    expect(String(call[1]?.body)).toContain('code_verifier=V');
    expect(String(call[1]?.body)).toContain(
      'redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback'
    );
  });
});

describe('refreshTokens', () => {
  it('exchanges a refresh token and maps the response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'A2', refresh_token: 'R2', expires_in: 1800 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const t0 = 2_000_000;
    const set = await refreshTokens({
      tokenEndpoint: 'https://a/token',
      refreshToken: 'OLD_R',
      now: () => t0,
    });
    expect(set.accessToken).toBe('A2');
    expect(set.refreshToken).toBe('R2');
    expect(set.expiresAt).toBe(t0 + 1800 * 1000);
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe('https://a/token');
    expect(String(call[1]?.body)).toContain('grant_type=refresh_token');
    expect(String(call[1]?.body)).toContain('refresh_token=OLD_R');
  });

  it('keeps the old refresh token when the response does not rotate it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'A3', expires_in: 900 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const set = await refreshTokens({
      tokenEndpoint: 'https://a/token',
      refreshToken: 'KEEP_ME',
      now: () => 0,
    });
    expect(set.accessToken).toBe('A3');
    expect(set.refreshToken).toBe('KEEP_ME');
  });
});
