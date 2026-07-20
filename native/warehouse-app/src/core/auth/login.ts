import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { generatePkce, randomUrlSafe } from './pkce';
import {
  discover,
  buildAuthorizeUrl,
  parseCallback,
  type OidcEndpoints,
} from './oidc';
import { oidcConfig } from '../../app/config';
import type { TokenSet } from './tokenStore';
import type { createTokenManager } from './tokenManager';

async function getJson(url: string): Promise<unknown> {
  const res = await tauriFetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

export async function exchangeCode(p: {
  tokenEndpoint: string;
  code: string;
  verifier: string;
  now?: () => number;
}): Promise<TokenSet> {
  const now = p.now ?? (() => Date.now());
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: oidcConfig.redirectUri,
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

export async function login(deps: {
  manager: ReturnType<typeof createTokenManager>;
}): Promise<void> {
  const endpoints = (await discover(
    oidcConfig.issuer,
    getJson
  )) as OidcEndpoints;
  const { verifier, challenge } = await generatePkce();
  const state = randomUrlSafe(32);
  const nonce = randomUrlSafe(32);

  const codePromise = new Promise<string>((resolve, reject) => {
    onOpenUrl((urls) => {
      try {
        const { code, state: got } = parseCallback(urls[0]);
        if (got !== state) return reject(new Error('state mismatch'));
        resolve(code);
      } catch (e) {
        reject(e);
      }
    });
  });

  await openUrl(buildAuthorizeUrl(oidcConfig, { state, nonce, challenge }));
  const code = await codePromise;
  const tokens = await exchangeCode({
    tokenEndpoint: endpoints.token_endpoint,
    code,
    verifier,
  });
  await deps.manager.set(tokens);
}
