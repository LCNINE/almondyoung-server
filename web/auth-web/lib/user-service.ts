import "server-only";

import { env } from "./env";

type SignInBody = { loginId: string; password: string; rememberMe?: boolean };
type ApiEnvelope<T> = { success: boolean; data: T };

export type TokenPair = { accessToken: string; refreshToken: string };

export type UserProfile = {
  id: string;
  loginId: string;
  username: string;
  email: string;
  isEmailVerified: boolean;
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `user-service returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
    );
  }
}

async function readApiData<T>(res: Response): Promise<T> {
  const body = await readJson<ApiEnvelope<T>>(res);
  return body.data;
}

async function throwIfBad(res: Response, ctx: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text();
  let message = text;
  try {
    const body = JSON.parse(text);
    message = body?.message ?? text;
    if (Array.isArray(message)) message = message.join(", ");
  } catch {
    // keep raw
  }
  throw new Error(`[${ctx}] ${res.status}: ${message}`);
}

export async function signIn(body: SignInBody): Promise<TokenPair> {
  const res = await fetch(`${env.userServiceUrl}/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  });
  await throwIfBad(res, "signin");
  return readApiData<TokenPair>(res);
}

export type LocalSignUpInput = {
  loginId: string;
  password: string;
  email: string;
  username: string;
  nickname: string;
  birthday: string;
  phoneNumber: string;
  isOver14: boolean;
  termsOfService: boolean;
  electronicTransaction: boolean;
  privacyPolicy: boolean;
  thirdPartySharing: boolean;
  marketingConsent: boolean;
};

export async function signUp(
  body: LocalSignUpInput,
): Promise<{ userId: string; signupToken: string; message: string }> {
  const res = await fetch(`${env.userServiceUrl}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  });
  await throwIfBad(res, "signup");
  return readApiData<{ userId: string; signupToken: string; message: string }>(res);
}

export async function callbackSignup(signupToken: string): Promise<TokenPair> {
  const res = await fetch(`${env.userServiceUrl}/auth/callback/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signupToken }),
    cache: "no-store",
    redirect: "manual",
  });
  await throwIfBad(res, "callback-signup");
  return readApiData<TokenPair>(res);
}

export async function restoreAccessToken(
  refreshToken: string,
): Promise<string> {
  const res = await fetch(`${env.userServiceUrl}/auth/restore-token`, {
    method: "POST",
    headers: { cookie: `refreshToken=${refreshToken}` },
    cache: "no-store",
    redirect: "manual",
  });
  await throwIfBad(res, "restore-token");
  const body = await readApiData<{ accessToken?: string }>(res);
  if (body.accessToken) return body.accessToken;

  // Fallback: older behavior sets accessToken as Set-Cookie only
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/accessToken=([^;]+)/);
  if (m?.[1]) return m[1];
  throw new Error("[restore-token] accessToken missing in response");
}

export type IssueOAuthCodeInput = {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  scope?: string;
  nonce?: string;
};

export async function issueOAuthCodeInternal(
  input: IssueOAuthCodeInput,
): Promise<{ code: string; expiresIn: number }> {
  if (!env.oauthInternalSecret) {
    throw new Error("OAUTH_INTERNAL_SECRET not configured on auth-web");
  }
  const res = await fetch(`${env.userServiceUrl}/oauth/internal/issue-code`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": env.oauthInternalSecret,
    },
    body: JSON.stringify(input),
    cache: "no-store",
    redirect: "manual",
  });
  await throwIfBad(res, "issue-code");
  return readApiData<{ code: string; expiresIn: number }>(res);
}

/**
 * `/oauth/authorize` 처리 직후, redirect_uri 가 client 등록 화이트리스트와 매칭되는지 user-service 에 위임 검증.
 * 미등록인 경우 OIDC error redirect 를 발사해 외부로 302 가 나가지 않도록 호출자가 로컬 에러 화면을 렌더해야 한다.
 */
export async function validateRedirectUriInternal(input: {
  clientId: string;
  redirectUri: string;
}): Promise<boolean> {
  if (!env.oauthInternalSecret) {
    throw new Error("OAUTH_INTERNAL_SECRET not configured on auth-web");
  }
  const res = await fetch(`${env.userServiceUrl}/oauth/internal/validate-redirect-uri`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": env.oauthInternalSecret,
    },
    body: JSON.stringify(input),
    cache: "no-store",
    redirect: "manual",
  });
  if (!res.ok) return false;
  const body = await readJson<{ valid?: boolean }>(res);
  return body.valid === true;
}

export async function getMe(accessToken: string): Promise<UserProfile> {
  const res = await fetch(`${env.userServiceUrl}/users/me`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    redirect: "manual",
  });
  await throwIfBad(res, "me");
  return readApiData<UserProfile>(res);
}
