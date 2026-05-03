import "server-only";

import { cookies } from "next/headers";

import type { TokenSet } from "./oidc-client";

const ACCESS_TOKEN = "accessToken";
const REFRESH_TOKEN = "refreshToken";
const ID_TOKEN = "idToken";
const STATE_COOKIE = "oidc_state";

const REFRESH_MAX_AGE = 60 * 60 * 24 * 14; // 2 weeks

const PROD = process.env.NODE_ENV === "production";

/**
 * `next/headers`의 cookies() 결과(RequestCookies)와 NextResponse.cookies(ResponseCookies)는
 * 모두 set(name, value, options) 시그니처를 공유한다. 둘 중 어느 jar 든 받을 수 있도록
 * 필요한 메서드만 추출한 구조적 타입을 쓴다 — next 내부 경로 import 회피.
 */
type Jar = {
  set(
    name: string,
    value: string,
    options?: {
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "lax" | "strict" | "none";
      path?: string;
      maxAge?: number;
      domain?: string;
    },
  ): unknown;
};

/**
 * admin-web 자체 도메인에 host-only 세션 쿠키 발급. parent-domain 속성을 일부러 지정하지 않아
 * 다른 호스트로의 누설을 차단한다 — OIDC RP 로 전환하면서 부모 도메인 공유는 폐기.
 */
function commonOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
} {
  return {
    httpOnly: true,
    secure: PROD,
    sameSite: "lax",
    path: "/",
  };
}

export async function setSessionCookies(tokens: TokenSet): Promise<void> {
  const jar = await cookies();
  writeSessionCookies(jar, tokens);
}

export function writeSessionCookies(jar: Jar, tokens: TokenSet): void {
  jar.set(ACCESS_TOKEN, tokens.accessToken, {
    ...commonOptions(),
    maxAge: tokens.expiresIn,
  });
  jar.set(REFRESH_TOKEN, tokens.refreshToken, {
    ...commonOptions(),
    maxAge: REFRESH_MAX_AGE,
  });
  if (tokens.idToken) {
    jar.set(ID_TOKEN, tokens.idToken, {
      ...commonOptions(),
      maxAge: REFRESH_MAX_AGE,
    });
  }
}

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  clearSessionCookiesOn(jar);
}

export function clearSessionCookiesOn(jar: Jar): void {
  const opts = { ...commonOptions(), maxAge: 0 };
  jar.set(ACCESS_TOKEN, "", opts);
  jar.set(REFRESH_TOKEN, "", opts);
  jar.set(ID_TOKEN, "", opts);
}

export async function getAccessToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACCESS_TOKEN)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(REFRESH_TOKEN)?.value ?? null;
}

export async function getIdToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ID_TOKEN)?.value ?? null;
}

// ──────────────────────────────────────────────
// state cookie (authorize → callback bridge)
// ──────────────────────────────────────────────

const STATE_TTL_SECONDS = 10 * 60; // 10 분

export async function setStateCookie(record: object): Promise<void> {
  const jar = await cookies();
  jar.set(STATE_COOKIE, Buffer.from(JSON.stringify(record), "utf8").toString("base64url"), {
    ...commonOptions(),
    maxAge: STATE_TTL_SECONDS,
  });
}

export async function consumeStateCookie<T = unknown>(): Promise<T | null> {
  const jar = await cookies();
  const raw = jar.get(STATE_COOKIE)?.value;
  if (!raw) return null;
  jar.set(STATE_COOKIE, "", { ...commonOptions(), maxAge: 0 });
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAMES = {
  ACCESS_TOKEN,
  REFRESH_TOKEN,
  ID_TOKEN,
  STATE_COOKIE,
} as const;
