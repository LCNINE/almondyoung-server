import "server-only";

import * as crypto from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { oidcEnv } from "./env";

/**
 * RP 가 authorize 단계에서 만들고 callback 단계에서 검증해야 하는 일회성 비밀들.
 * `oidc_state` 쿠키로 직렬화되어 IdP redirect 사이에 보존된다.
 */
export type OidcStateRecord = {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** 로그인 후 돌려보낼 admin-web 내부 경로 (절대 외부 URL 거부) */
  redirectTo: string;
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
  return buf.toString("base64url");
}

function randomBase64Url(bytes: number): string {
  return base64Url(crypto.randomBytes(bytes));
}

/** PKCE S256: BASE64URL(SHA256(verifier)). */
function s256(verifier: string): string {
  return base64Url(crypto.createHash("sha256").update(verifier).digest());
}

/**
 * authorize 단계 비밀 + redirectTo 를 함께 묶어 반환. 호출자는 record 를 단일
 * 단기 HttpOnly 쿠키로 직렬화하고, authorizeUrl 로 사용자를 redirect 한다.
 */
export function createAuthorizationRequest(redirectTo: string): {
  authorizeUrl: string;
  stateRecord: OidcStateRecord;
} {
  const state = randomBase64Url(32);
  const nonce = randomBase64Url(32);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = s256(codeVerifier);

  const url = new URL(oidcEnv.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", oidcEnv.clientId);
  url.searchParams.set("redirect_uri", oidcEnv.redirectUri);
  url.searchParams.set("scope", oidcEnv.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return {
    authorizeUrl: url.toString(),
    stateRecord: { state, nonce, codeVerifier, redirectTo },
  };
}

/**
 * IdP 로부터 받은 code 를 access/refresh/id token 으로 교환.
 * client_secret 은 application/x-www-form-urlencoded 본문에 포함 (RFC 6749 §2.3.1
 * client_secret_post 방식). user-service 가 client_secret_basic 도 받을 수 있으나
 * post 가 더 보편적이라 통일.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: oidcEnv.redirectUri,
    client_id: oidcEnv.clientId,
    client_secret: oidcEnv.clientSecret,
    code_verifier: codeVerifier,
  });

  const res = await fetch(`${oidcEnv.issuerUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
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
 * refresh_token grant 로 새 access_token 발급.
 * user-service 는 refresh 회전 (rotation) 을 강제하므로 응답의 새 refresh_token 도 함께 저장해야 한다.
 */
export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: oidcEnv.clientId,
    client_secret: oidcEnv.clientSecret,
  });

  const res = await fetch(`${oidcEnv.issuerUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
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
 * id_token 검증 — JWKS 서명 + iss + aud + nonce 일치.
 * exp/iat/nbf 는 jose 가 기본 검사한다.
 */
export async function verifyIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<{ sub: string; nonce?: string }> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: oidcEnv.issuerUrl,
    audience: oidcEnv.clientId,
    algorithms: ["RS256"],
  });

  if (payload.nonce !== expectedNonce) {
    throw new Error("id_token nonce mismatch");
  }

  return {
    sub: payload.sub as string,
    nonce: payload.nonce as string | undefined,
  };
}

/**
 * RP-Initiated Logout URL 생성. id_token_hint 가 있어야 IdP 가 어떤 세션을 종료할지 식별.
 * post_logout_redirect_uri 는 client 등록 시의 화이트리스트와 정확히 일치해야 한다.
 */
export function buildEndSessionUrl(idToken: string | null): string {
  const url = new URL(`${oidcEnv.issuerUrl}/oauth/end_session`);
  url.searchParams.set("client_id", oidcEnv.clientId);
  url.searchParams.set("post_logout_redirect_uri", oidcEnv.postLogoutRedirectUri);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  return url.toString();
}
