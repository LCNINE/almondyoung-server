"use server"

import type {
  BillingAgreementDto,
  BillingMethodDto,
} from "@lib/types/dto/wallet"
import { isInvoiceBillingEnabled } from "@lib/utils/invoice-billing"
import {
  decideSignupResume,
  type SignupResumeTarget,
} from "@lib/utils/signup-resume"
import { api } from "../api"
import { getCurrentSubscription } from "./index"

/**
 * 계좌만 등록하고 멤버십 가입은 안 된 고객인지 판정한다.
 *
 * 기존 조회 함수들은 실패를 빈 목록·null 로 접는다. 그걸 그대로 쓰면 조회 실패가 «약정 없음»·«구독 없음»
 * 으로 읽혀, 이미 가입한 고객에게 「가입 마무리하기」를 띄운다. 그래서 여기서는 실패를 삼키지 않고
 * 하나라도 실패하면 `unknown` 을 돌려준다 — 화면은 모를 때 아무것도 보이지 않는다.
 */
export async function getSignupResumeTarget(): Promise<
  SignupResumeTarget | { kind: "unknown" }
> {
  const pendingMandateAllowed = isInvoiceBillingEnabled()
  try {
    const [subscription, methods, agreements] = await Promise.all([
      // 구독 없음(404)만 null 이고 나머지 실패는 던진다.
      getCurrentSubscription(),
      api<BillingMethodDto[]>(
        "wallet",
        `/v1/billing-methods${pendingMandateAllowed ? "?includePendingMandate=true" : ""}`,
        { method: "GET", cache: "no-store", withAuth: true, timeout: 3000 }
      ),
      api<BillingAgreementDto[]>("wallet", "/v1/billing-agreements", {
        method: "GET",
        cache: "no-store",
        withAuth: true,
        timeout: 3000,
      }),
    ])
    return decideSignupResume({
      hasCurrentSubscription: !!subscription,
      methods,
      agreements,
      pendingMandateAllowed,
    })
  } catch {
    return { kind: "unknown" }
  }
}
