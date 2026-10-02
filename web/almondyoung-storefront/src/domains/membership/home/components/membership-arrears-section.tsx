"use client"

import { useEffect, useState, useTransition } from "react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { getMyArrears, startArrearsCheckout } from "@/lib/api/membership"
import type { MyArrearsDto } from "@lib/types/dto/membership"

/**
 * 미수(미납 멤버십 요금) 상세 — **이 화면 한 곳에만** 둔다.
 *
 * 마이페이지 메인·홈은 금액과 한 줄 이유, 그리고 여기로 오는 링크까지만 갖는다. 같은 설명을 네 곳에
 * 복제하면 한 곳만 고쳐져 반드시 갈린다.
 *
 * 미수는 자격이 «회수된» 뒤에 남는 것이라 가입자 화면이 아니라 멤버십 페이지 최상단에 둔다 —
 * 회수된 고객에게는 아래가 비가입자 화면으로 바뀌기 때문이다.
 */
export default function MembershipArrearsSection() {
  const t = useTranslations("mypage.membership.arrears")
  const params = useParams()
  const countryCode = (params?.countryCode as string) ?? "kr"
  const [arrears, setArrears] = useState<MyArrearsDto | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let active = true
    getMyArrears().then((rows) => {
      if (active) setArrears(rows)
    })
    return () => {
      active = false
    }
  }, [])

  const handlePay = () => {
    startTransition(async () => {
      try {
        // returnUrl 에 쿼리를 붙이지 않는다 — wallet 이 결과 파라미터를 덧붙이며 URL 이 깨진 전례가 있다.
        const returnUrl = `${window.location.origin}/${countryCode}/mypage/membership`
        const { intentId } = await startArrearsCheckout(returnUrl)
        const walletWebUrl =
          process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"
        window.location.href = `${walletWebUrl}/pay/${intentId}?region=${countryCode}`
      } catch (error) {
        const err = error as Error & { digest?: string }
        if (err?.digest === "UNAUTHORIZED" || err?.message === "UNAUTHORIZED")
          throw error
        toast.error(t("startError"))
      }
    })
  }

  // 미수가 없으면(대부분의 고객) 아무것도 그리지 않는다. 빈 박스를 남기지 않는다.
  if (!arrears || arrears.outstanding.count === 0) return null

  return (
    <section
      data-testid="membership-arrears-section"
      className="border-border mb-3 w-full rounded-xl border bg-white p-4"
    >
      <h3 className="text-foreground text-sm font-bold">{t("title")}</h3>
      <p className="text-muted-foreground mt-1 text-xs leading-5">
        {t("whatHappened")}
      </p>

      <p className="text-foreground mt-3 text-base font-bold">
        {t("totalAmount", {
          amount: arrears.outstanding.total.toLocaleString(),
        })}
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {arrears.items.map((item) => (
          <li
            key={item.id}
            className="border-border rounded-lg border px-3 py-2.5 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {item.periodStart && item.periodEnd
                  ? `${formatDate(item.periodStart, DATE_FORMATS.KO_DOT)} ~ ${formatDate(item.periodEnd, DATE_FORMATS.KO_DOT)}`
                  : formatDate(item.createdAt, DATE_FORMATS.KO_DOT)}
              </span>
              <span className="text-foreground font-medium">
                {t("amount", { amount: item.amount.toLocaleString() })}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 leading-4">
              {item.cause === "MANDATE_REJECTED"
                ? t("causeMandateRejected")
                : t("causeUncollectible")}
            </p>
          </li>
        ))}
      </ul>

      {/* 앞으로 어떻게 되는지 — 이게 없으면 '왜 아직 멤버십이 안 붙지' 가 그대로 문의가 된다. */}
      <div className="bg-muted mt-3 rounded-lg px-3 py-2.5">
        <p className="text-muted-foreground text-xs leading-5">
          {t("whatsNext")}
        </p>
        <p className="text-muted-foreground mt-1 text-xs leading-5">
          {t("paymentMethodNotice")}
        </p>
      </div>

      <Button
        className="mt-3 h-[52px] w-full rounded-xl text-base font-bold"
        disabled={pending}
        onClick={handlePay}
      >
        {pending ? t("starting") : t("payNow")}
      </Button>
    </section>
  )
}
