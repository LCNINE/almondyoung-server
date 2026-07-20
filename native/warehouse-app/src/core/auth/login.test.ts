import { describe, it, expect, vi } from 'vitest';

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

import { exchangeCode } from './login';

describe('exchangeCode', () => {
  it('maps the token response to a TokenSet with expiresAt', async () => {
    const t0 = 1_000_000;
    const set = await exchangeCode({
      tokenEndpoint: 'https://a/token',
      code: 'CODE',
      verifier: 'V',
      now: () => t0,
    });
    expect(set.accessToken).toBe('A');
    expect(set.refreshToken).toBe('R');
    expect(set.expiresAt).toBe(t0 + 3600 * 1000);
  });
});
