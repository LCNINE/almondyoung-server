import 'server-only';

import * as crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { oidcEnv } from './env';

/**
 * authorize 단계에서 생성하고 callback 에서 검증하는 일회성 비밀.
 * `oidc_state` 쿠키로 직렬화돼 IdP redirect 사이에 보존된다.
 *
 * `prompt` 는 wallet-web 특유 — login_required fallback 이 다음 시도에서 prompt 를 빼야 하므로
 * 어떤 값으로 authorize 했는지 기록해 둔다.
 */
export type OidcStateRecord = {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** 로그인 후 돌려보낼 wallet-web 내부 경로 (절대 외부 URL 거부) */
  redirectTo: string;
  /** 이 authorize 요청에 사용한 prompt 값. 'none' 이면 callback 에서 login_required fallback 분기. */
  prompt?: 'none' | 'login' | 'select_account' | 'consent';
};

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
};

const JWKS = createRemoteJWKSet(new URL(oidcEnv.jwksUrl));

function base64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

function randomBase64Url(bytes: number): string {
  return base64Url(crypto.randomBytes(bytes));
}

/** PKCE S256: BASE64URL(SHA256(verifier)). */
function s256(verifier: string): string {
  return base64Url(crypto.createHash('sha256').update(verifier).digest());
}

/**
 * authorize URL + state record 생성. 호출자는 record 를 단기 HttpOnly 쿠키로 보존하고
 * authorizeUrl 로 사용자를 redirect 한다.
 *
 * `prompt`:
 *   - undefined: prompt 미전송 (auth-web default — 다중 계정이면 hub, 단일이면 silent SSO)
 *   - 'none': 활성 IdP 세션이 있으면 silent. 없으면 IdP 가 `error=login_required` 로 회신 → callback 이 fallback.
 *   - 'select_account': 명시적 계정 전환 — 항상 hub.
 *   - 'login': 강제 재로그인 — 항상 signin.
 */
export function createAuthorizationRequest(
  redirectTo: string,
  prompt?: OidcStateRecord['prompt'],
): {
  authorizeUrl: string;
  stateRecord: OidcStateRecord;
} {
  const state = randomBase64Url(32);
  const nonce = randomBase64Url(32);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = s256(codeVerifier);

  const url = new URL(oidcEnv.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', oidcEnv.clientId);
  url.searchParams.set('redirect_uri', oidcEnv.redirectUri);
  url.searchParams.set('scope', oidcEnv.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (prompt) url.searchParams.set('prompt', prompt);

  return {
    authorizeUrl: url.toString(),
    stateRecord: { state, nonce, codeVerifier, redirectTo, prompt },
  };
}

/**
 * code → token 교환. client_secret 은 form body 에 포함 (RFC 6749 §2.3.1 client_secret_post).
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: oidcEnv.redirectUri,
    client_id: oidcEnv.clientId,
    client_secret: oidcEnv.clientSecret,
    code_verifier: codeVerifier,
  });

  const res = await fetch(`${oidcEnv.issuerUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token exchange failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    id_token?: string;
    expires_in: number;
    token_type: string;
    scope?: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    expiresIn: json.expires_in,
    tokenType: json.token_type,
    scope: json.scope,
  };
}

/**
 * refresh_token grant. user-service 가 회전 (rotation) 강제 — 응답의 새 refresh_token 도 저장 필수.
 */
export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: oidcEnv.clientId,
    client_secret: oidcEnv.clientSecret,
  });

  const res = await fetch(`${oidcEnv.issuerUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`refresh failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    id_token?: string;
    expires_in: number;
    token_type: string;
    scope?: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    expiresIn: json.expires_in,
    tokenType: json.token_type,
    scope: json.scope,
  };
}

/**
 * payment_handoff grant. storefront 가 인증된 고객에게 발급한 단기 핸드오프 토큰을 confidential
 * client 인증과 함께 교환해 wallet-web 자기 세션 토큰셋을 받는다. 별도 서브도메인에서 OIDC
 * silent-SSO/쿠키로 세션을 재확보하지 못하는 인앱브라우저·ITP 환경을 우회하는 경로.
 */
export async function exchangeHandoffForTokens(handoffToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'payment_handoff',
    code: handoffToken,
    client_id: oidcEnv.clientId,
    client_secret: oidcEnv.clientSecret,
  });

  const res = await fetch(`${oidcEnv.issuerUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`handoff exchange failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    id_token?: string;
    expires_in: number;
    token_type: string;
    scope?: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    expiresIn: json.expires_in,
    tokenType: json.token_type,
    scope: json.scope,
  };
}

/** id_token 검증 — JWKS 서명 + iss + aud + nonce 일치. exp/iat/nbf 는 jose 가 기본 검사. */
export async function verifyIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<{ sub: string; nonce?: string }> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: oidcEnv.issuerUrl,
    audience: oidcEnv.clientId,
    algorithms: ['RS256'],
  });

  if (payload.nonce !== expectedNonce) {
    throw new Error('id_token nonce mismatch');
  }

  return {
    sub: payload.sub as string,
    nonce: payload.nonce as string | undefined,
  };
}

/**
 * RP-Initiated Logout URL. id_token_hint 가 있어야 IdP 가 어떤 세션을 종료할지 식별.
 * post_logout_redirect_uri 는 클라이언트 등록 시 화이트리스트와 정확히 일치해야 한다.
 */
export function buildEndSessionUrl(idToken: string | null): string {
  const url = new URL(`${oidcEnv.issuerUrl}/oauth/end_session`);
  url.searchParams.set('client_id', oidcEnv.clientId);
  url.searchParams.set('post_logout_redirect_uri', oidcEnv.postLogoutRedirectUri);
  if (idToken) url.searchParams.set('id_token_hint', idToken);
  return url.toString();
}
