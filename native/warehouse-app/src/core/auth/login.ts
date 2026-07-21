import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { generatePkce, randomUrlSafe } from './pkce';
import { discover, buildAuthorizeUrl, parseCallback } from './oidc';
import { oidcConfig } from '../../app/config';
import type { TokenSet } from './tokenStore';
import type { createTokenManager } from './tokenManager';

async function getJson(url: string): Promise<unknown> {
  const res = await tauriFetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

export async function discoverEndpoints() {
  return discover(oidcConfig.issuer, getJson);
}

export async function exchangeCode(p: {
  tokenEndpoint: string;
  code: string;
  verifier: string;
  redirectUri: string;
  now?: () => number;
}): Promise<TokenSet> {
  const now = p.now ?? (() => Date.now());
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: oidcConfig.clientId,
    code_verifier: p.verifier,
  });
  const res = await tauriFetch(p.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const j = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    id_token?: string;
    expires_in: number;
  };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    idToken: j.id_token,
    expiresAt: now() + j.expires_in * 1000,
  };
}

export async function refreshTokens(p: {
  tokenEndpoint: string;
  refreshToken: string;
  now?: () => number;
}): Promise<TokenSet> {
  const now = p.now ?? (() => Date.now());
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
    client_id: oidcConfig.clientId,
  });
  const res = await tauriFetch(p.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const j = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
  };
  return {
    accessToken: j.access_token,
    // Refresh responses may omit a new refresh token (no rotation) — keep the old one.
    refreshToken: j.refresh_token ?? p.refreshToken,
    idToken: j.id_token,
    expiresAt: now() + j.expires_in * 1000,
  };
}

export async function loginWithDeepLink(deps: {
  manager: ReturnType<typeof createTokenManager>;
}): Promise<void> {
  const endpoints = await discover(oidcConfig.issuer, getJson);
  const { verifier, challenge } = await generatePkce();
  const state = randomUrlSafe(32);
  const nonce = randomUrlSafe(32);

  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: unknown) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  // Register the deep-link listener BEFORE opening the browser, and capture the
  // unlisten fn so it is torn down when the flow settles. Otherwise a listener
  // leaks on every login attempt, and a stale/abandoned attempt could later
  // fire and overwrite the token store with an outdated session's tokens.
  const unlisten = await onOpenUrl((urls) => {
    try {
      const { code, state: got } = parseCallback(urls[0]);
      if (got !== state) return rejectCode(new Error('state mismatch'));
      resolveCode(code);
    } catch (e) {
      rejectCode(e);
    }
  });

  try {
    await openUrl(buildAuthorizeUrl(oidcConfig, { state, nonce, challenge }));
    const code = await codePromise;
    const tokens = await exchangeCode({
      tokenEndpoint: endpoints.token_endpoint,
      code,
      verifier,
      redirectUri: oidcConfig.redirectUri,
    });
    await deps.manager.set(tokens);
  } finally {
    unlisten();
  }
}

export async function loginWithLoopback(deps: {
  manager: ReturnType<typeof createTokenManager>;
  onStep?: (step: string) => void;
}): Promise<void> {
  const step = deps.onStep ?? (() => {});

  step('1/6 discovering…');
  const endpoints = await discoverEndpoints();
  const { verifier, challenge } = await generatePkce();
  const state = randomUrlSafe(32);
  const nonce = randomUrlSafe(32);

  step('2/6 starting loopback listener…');
  const { port } = await invoke<{ port: number }>('oauth_loopback_start');
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  step(`3/6 opening browser (redirect ${redirectUri})…`);
  await openUrl(buildAuthorizeUrl({ ...oidcConfig, redirectUri }, { state, nonce, challenge }));

  step('4/6 waiting for browser callback…');
  const cb = await invoke<{ code: string; state: string }>('oauth_loopback_wait', { port });
  if (cb.state !== state) throw new Error('state mismatch');

  step('5/6 exchanging code for tokens…');
  const tokens = await exchangeCode({
    tokenEndpoint: endpoints.token_endpoint,
    code: cb.code,
    verifier,
    redirectUri,
  });

  step('6/6 saving tokens…');
  await deps.manager.set(tokens);
  step('tokens saved');
}
