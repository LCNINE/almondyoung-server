import Link from "next/link"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { previewCouponCode } from "@/lib/api/medusa/store"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { CouponClaimButton } from "./_components/coupon-claim-button"

interface PageProps {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ code?: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("couponClaim")
  return { title: t("pageTitle") }
}

export default async function CouponClaimPage({ params, searchParams }: PageProps) {
  const { countryCode } = await params
  const { code } = await searchParams
  const t = await getTranslations("couponClaim")

  if (!code) {
    return <ErrorState message={t("couponNotFound")} />
  }

  let result
  try {
    result = await previewCouponCode(code)
  } catch {
    return <ErrorState message={t("couponNotFound")} />
  }

  const { valid, reason, claimable, is_assigned, promotion } = result

  if (!valid || !promotion) {
    if (reason === "LOGIN_REQUIRED") {
      const loginHref = `/${countryCode}/login?redirect_to=${encodeURIComponent(`/${countryCode}/coupons/claim?code=${code}`)}`
      return (
        <PageShell>
          <div className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">{t("hint")}</p>
            <a href={loginHref}>
              <Button className="w-full" size="lg">{t("loginToClaim")}</Button>
            </a>
          </div>
        </PageShell>
      )
    }

    const message =
      reason === "COUPON_EXPIRED" ? t("couponExpired")
      : reason === "COUPON_INACTIVE" ? t("couponInactive")
      : reason === "COUPON_GROUP_RESTRICTED" ? t("couponGroupRestricted")
      : t("couponNotFound")

    return <ErrorState message={message} />
  }

  const { discount, expires_at, promotion_id_to_claim } = promotion

  const discountLabel = discount
    ? discount.type === "percentage"
      ? t("discountPercent", { value: discount.value })
      : t("discountAmount", { amount: discount.value.toLocaleString("ko-KR") })
    : null

  const expiryLabel = expires_at
    ? t("expiresAt", { date: formatDate(expires_at, DATE_FORMATS.KO_DOT) })
    : t("unlimited")

  const promotionIdForClaim = promotion_id_to_claim ?? promotion.id

  return (
    <PageShell>
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="h-1.5 bg-primary" />
        <div className="p-6 space-y-3">
          <p className="font-mono text-xs text-muted-foreground">{promotion.code}</p>
          {discountLabel && (
            <p className="text-3xl font-bold tracking-tight">{discountLabel}</p>
          )}
          <p className="text-sm text-muted-foreground">{expiryLabel}</p>
        </div>
      </div>

      <div className="space-y-3">
        {is_assigned ? (
          <>
            <div className="flex justify-center">
              <Badge variant="secondary" className="px-4 py-1.5 text-sm">
                {t("alreadyClaimed")}
              </Badge>
            </div>
            <Link href={`/${countryCode}/mypage/coupons`}>
              <Button variant="outline" className="w-full">{t("goToCoupons")}</Button>
            </Link>
          </>
        ) : claimable ? (
          <CouponClaimButton promotionId={promotionIdForClaim} countryCode={countryCode} />
        ) : null}
      </div>

      <p className="text-xs text-center text-muted-foreground">{t("hint")}</p>
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-16">
      <div className="max-w-sm w-full space-y-4">{children}</div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4">
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  )
}
