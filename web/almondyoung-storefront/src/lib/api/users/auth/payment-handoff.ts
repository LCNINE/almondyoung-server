"use server"

import { api } from "@/lib/api/api"

/**
 * 결제창(wallet-web) 핸드오프 토큰 발급.
 *
 * 인증된 고객 세션으로 user-service `/auth/payment-handoff` 를 호출해 단기(120s) 1회용 토큰을 받는다.
 * 결제 진입 시 이 토큰을 wallet-web `/auth/handoff` 로 넘기면, wallet-web 이 별도 서브도메인에서
 * OIDC silent-SSO / 부모도메인 쿠키 공유에 의존하지 않고 자기 세션을 확보한다 — 인앱브라우저·iOS
 * Safari(ITP) 에서 결제창이 안 넘어가던 문제의 근본 우회.
 */
export async function mintPaymentHandoffToken(): Promise<string> {
  const res = await api<{ handoffToken: string }>("users", "/auth/payment-handoff", {
    method: "POST",
  })
  return res.handoffToken
}
