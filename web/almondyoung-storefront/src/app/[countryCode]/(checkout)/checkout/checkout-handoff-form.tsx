"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { trackEventOnce } from "@/lib/analytics/gtag"

interface Props {
  /** wallet-web 의 POST 핸드오프 착지점 (절대 URL). */
  action: string
  /** user-service 가 발급한 120초 1회용 핸드오프 토큰. 발급 실패 시 빈 문자열. */
  handoffToken: string
  /** `_medusa_jwt` 를 봉인한 값(60초, 카트 바인딩). wallet-web 이 서버에서 열어 쓴다. */
  medusaJwt: string
  cartId: string
  countryCode: string
  /** GA4 begin_checkout payload. 도메인이 갈리기 전 여기서 발사한다. */
  gaEcommerce: Record<string, unknown>
}

/**
 * storefront → wallet-web 체크아웃 핸드오프.
 *
 * 토큰과 카트 id 를 쿼리스트링이 아니라 **폼 본문**으로 넘긴다. URL 로 보내면 브라우저 히스토리·
 * 서버 액세스 로그·Referer 에 고객 자격증명이 그대로 남는다.
 */
const HANDOFF_FLAG = "checkout-handoff-submitted"

export default function CheckoutHandoffForm({
  action,
  handoffToken,
  medusaJwt,
  cartId,
  countryCode,
  gaEcommerce,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null)
  const submittedRef = useRef(false)
  const router = useRouter()

  useEffect(() => {
    if (submittedRef.current) return

    // wallet-web 에서 뒤로가기로 돌아온 경우만 장바구니로 내보낸다.
    // nav.type 은 document 단위라 클라이언트 라우팅으로는 갱신되지 않아 플래그를 같이 본다.
    const [nav] = performance.getEntriesByType(
      "navigation"
    ) as PerformanceNavigationTiming[]
    if (nav?.type === "back_forward" && sessionStorage.getItem(HANDOFF_FLAG)) {
      sessionStorage.removeItem(HANDOFF_FLAG)
      router.replace(`/${countryCode}/cart`)
      return
    }

    submittedRef.current = true
    sessionStorage.setItem(HANDOFF_FLAG, "1")
    // 결제창은 다른 도메인이라 GA 세션이 끊긴다. 넘어가기 전에 발사한다.
    // (체크아웃 진입 = 결제수단 화면 진입이 된 뒤라 add_payment_info 도 같이 보낸다.)
    trackEventOnce(`ga4_begin_checkout_${cartId}`, "begin_checkout", gaEcommerce)
    trackEventOnce(
      `ga4_add_payment_info_${cartId}`,
      "add_payment_info",
      gaEcommerce
    )
    formRef.current?.submit()
  }, [cartId, countryCode, gaEcommerce, router])

  return (
    <>
      <form ref={formRef} method="POST" action={action} className="hidden">
        <input type="hidden" name="h" value={handoffToken} />
        <input type="hidden" name="medusa_jwt" value={medusaJwt} />
        <input type="hidden" name="cart_id" value={cartId} />
        <input type="hidden" name="region" value={countryCode} />
      </form>
      <main className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <span className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            결제 화면으로 이동하고 있어요
          </p>
        </div>
      </main>
    </>
  )
}
