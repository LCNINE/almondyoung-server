import "server-only";

import { env } from "./env";

type SignInBody = { loginId: string; password: string; rememberMe?: boolean };

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
  return readJson<TokenPair>(res);
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
): Promise<{ userId: string; message: string }> {
  const res = await fetch(`${env.userServiceUrl}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  });
  await throwIfBad(res, "signup");
  return readJson<{ userId: string; message: string }>(res);
}

export async function callbackSignup(userId: string): Promise<TokenPair> {
  const res = await fetch(`${env.userServiceUrl}/auth/callback/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
    cache: "no-store",
    redirect: "manual",
  });
  await throwIfBad(res, "callback-signup");
  return readJson<TokenPair>(res);
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
  const body = await readJson<{ accessToken?: string }>(res);
  if (body.accessToken) return body.accessToken;

  // Fallback: older behavior sets accessToken as Set-Cookie only
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/accessToken=([^;]+)/);
  if (m?.[1]) return m[1];
  throw new Error("[restore-token] accessToken missing in response");
}

export async function getMe(accessToken: string): Promise<UserProfile> {
  const res = await fetch(`${env.userServiceUrl}/users/me`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    redirect: "manual",
  });
  await throwIfBad(res, "me");
  return readJson<UserProfile>(res);
}
