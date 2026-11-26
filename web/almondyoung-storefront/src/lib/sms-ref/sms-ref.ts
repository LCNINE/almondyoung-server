import type { NextRequest, NextResponse } from "next/server"
import { api } from "@/lib/api/api"

/**
 * 추적 링크(`/r/<코드>`)를 누른 브라우저에 남겨 두는 코드. 그 브라우저의 계정을 알게 되는 순간
 * (이미 로그인 · 토큰 복구 · 로그인/가입 콜백) notification 에 «이 링크 ↔ 이 계정»을 기록하고 지운다.
 */
export const SMS_REF_COOKIE = "sms_ref"
export const SMS_REF_MAX_AGE = 7 * 24 * 60 * 60
export const SMS_REF_CODE = /^[A-Za-z0-9_-]{8}$/

export type SmsRefKind = "clicked_signed_in" | "login" | "signup"

export function smsRefCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: SMS_REF_MAX_AGE,
  }
}

/**
 * 방금 받은 토큰을 직접 싣는다 — 토큰 복구·로그인 직후엔 새 토큰이 응답 쿠키에만 있어 `withAuth` 가 옛 토큰을 보낸다.
 * 기록 실패는 사용자 흐름을 막지 않는다: 던지지 않고 false.
 */
export async function recordSmsRef(code: string, accessToken: string, kind: SmsRefKind): Promise<boolean> {
  try {
    await api<void>("notification", `/sms-gate/links/${encodeURIComponent(code)}/attributions`, {
      method: "POST",
      body: { kind },
      withAuth: false,
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      timeout: 3000,
    })
    return true
  } catch (error) {
    console.warn("[sms-ref] attribution failed", (error as Error).message)
    return false
  }
}

/** 요청에 유효한 sms_ref 가 있으면 기록하고 응답에서 쿠키를 지운다. 실패해도 지운다 — 없는 코드를 7일 내내 다시 부르지 않게. */
export async function settleSmsRef(
  request: NextRequest,
  response: NextResponse,
  accessToken: string,
  kind: SmsRefKind
): Promise<void> {
  const code = request.cookies.get(SMS_REF_COOKIE)?.value
  if (!code || !SMS_REF_CODE.test(code)) return
  await recordSmsRef(code, accessToken, kind)
  response.cookies.set(SMS_REF_COOKIE, "", { ...smsRefCookieOptions(), maxAge: 0 })
}
