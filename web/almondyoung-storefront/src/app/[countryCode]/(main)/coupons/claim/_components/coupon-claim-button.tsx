"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { claimCoupon } from "@/lib/api/medusa/store"

interface CouponClaimButtonProps {
  promotionId: string
  countryCode: string
}

async function tryRestoreTokenAndRedirect(countryCode: string): Promise<void> {
  try {
    const res = await fetch("/api/auth/restore-token", { method: "POST", credentials: "include" })
    if (res.ok) return
  } catch {}
  const redirectTo = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.href = `/${countryCode}/login?redirect_to=${redirectTo}`
}

export function CouponClaimButton({ promotionId, countryCode }: CouponClaimButtonProps) {
  const t = useTranslations("couponClaim")
  const [isPending, startTransition] = useTransition()
  const [claimed, setClaimed] = useState(false)

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

  if (claimed) {
    return (
      <div className="space-y-3">
        <div className="flex flex-col items-center gap-2 py-2">
          <CheckCircle className="h-8 w-8 text-green-500" />
          <p className="font-medium">{t("claimSuccess")}</p>
        </div>
        <Link href={`/${countryCode}/mypage/coupons`}>
          <Button variant="outline" className="w-full">{t("goToCoupons")}</Button>
        </Link>
      </div>
    )
  }

  return (
    <Button
      className="w-full"
      size="lg"
      onClick={handleClaim}
      disabled={isPending}
    >
      {isPending ? t("claiming") : t("claimButton")}
    </Button>
  )
}
