"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { claimCoupon } from "@/lib/api/medusa/store"

export type CouponBlockReason =
  | "not_found"
  | "inactive"
  | "expired"
  | "not_started"
  | "group_restricted"
  | "not_assigned"
  | "exhausted"

export type CouponClaimState =
  | { kind: "claimable"; promotionId: string }
  | { kind: "claimed" }
  | { kind: "usable" }
  | { kind: "login"; loginHref: string }
  | { kind: "blocked"; reason: CouponBlockReason }

interface CouponClaimButtonProps {
  countryCode: string
  state: CouponClaimState
}

// 발급 불가 사유 → 안내 메시지 키. 기존 reason 문구를 그대로 토스트로 재사용한다.
const BLOCK_MESSAGE_KEY: Record<CouponBlockReason, string> = {
  not_found: "couponNotFound",
  inactive: "couponInactive",
  expired: "couponExpired",
  not_started: "couponNotStarted",
  group_restricted: "couponGroupRestricted",
  not_assigned: "couponNotAssigned",
  exhausted: "couponExhausted",
}

async function tryRestoreTokenAndRedirect(countryCode: string): Promise<void> {
  try {
    const res = await fetch("/api/auth/restore-token", { method: "POST", credentials: "include" })
    if (res.ok) return
  } catch {}
  const redirectTo = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.href = `/${countryCode}/login?redirect_to=${redirectTo}`
}

export function CouponClaimButton({ countryCode, state }: CouponClaimButtonProps) {
  const t = useTranslations("couponClaim")
  const [isPending, startTransition] = useTransition()
  const [claimed, setClaimed] = useState(false)

  const goToCoupons = (
    <Link href={`/${countryCode}/mypage/coupons`}>
      <Button variant="outline" className="w-full">{t("goToCoupons")}</Button>
    </Link>
  )

  // 발급 완료 (이번 클릭으로 방금 발급받음)
  if (claimed) {
    return (
      <div className="space-y-3">
        <div className="flex flex-col items-center gap-2 py-2">
          <CheckCircle className="h-8 w-8 text-green-500" />
          <p className="font-medium">{t("claimSuccess")}</p>
        </div>
        {goToCoupons}
      </div>
    )
  }

  switch (state.kind) {
    case "claimable": {
      const promotionId = state.promotionId
      const handleClaim = () => {
        startTransition(async () => {
          try {
            await claimCoupon(promotionId)
            setClaimed(true)
            toast.success(t("toasts.claimSuccess"))
          } catch (error: unknown) {
            const err = error as Error & { digest?: string }
            if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
              await tryRestoreTokenAndRedirect(countryCode)
              return
            }
            toast.error(t("toasts.claimFailed"))
          }
        })
      }
      return (
        <Button className="w-full" size="lg" onClick={handleClaim} disabled={isPending}>
          {isPending ? t("claiming") : t("claimButton")}
        </Button>
      )
    }

    case "claimed":
      return (
        <div className="space-y-3">
          <div className="flex justify-center">
            <span className="rounded-full bg-secondary px-4 py-1.5 text-sm text-muted-foreground">
              {t("alreadyClaimed")}
            </span>
          </div>
          {goToCoupons}
        </div>
      )

    case "usable":
      return (
        <div className="space-y-3">
          <div className="flex justify-center">
            <span className="rounded-full bg-secondary px-4 py-1.5 text-sm text-muted-foreground">
              {t("usableNow")}
            </span>
          </div>
          {goToCoupons}
        </div>
      )

    case "login":
      return (
        <a href={state.loginHref}>
          <Button className="w-full" size="lg">{t("loginToClaim")}</Button>
        </a>
      )

    case "blocked": {
      const reason = state.reason
      // 발급 불가 쿠폰도 버튼은 노출 — 누르면 사유를 토스트로 안내(에이블리 방식).
      // disabled 대신 muted 스타일 + 클릭 허용해 모바일 탭에서도 토스트가 뜨게 한다.
      const handleBlocked = () => toast.error(t(BLOCK_MESSAGE_KEY[reason]))
      return (
        <Button
          variant="secondary"
          className="w-full text-muted-foreground"
          size="lg"
          onClick={handleBlocked}
        >
          {t("claimButton")}
        </Button>
      )
    }
  }
}
