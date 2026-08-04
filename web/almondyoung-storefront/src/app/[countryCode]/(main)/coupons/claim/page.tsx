import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { previewCouponCode, type CouponPreviewResult } from "@/lib/api/medusa/store"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { CouponClaimButton, type CouponClaimState } from "./_components/coupon-claim-button"

interface PageProps {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ code?: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("couponClaim")
  return { title: t("pageTitle") }
}

// preview 결과 → 발급 버튼 상태. 쿠폰 정보(카드)를 그릴 수 있는 경우엔 카드 + 버튼을,
// 쿠폰 정보 자체가 없는 종결 사유(존재하지 않음/비활성/기간 등)는 메시지만 보여준다.
function resolveClaimState(
  result: CouponPreviewResult,
  countryCode: string,
  code: string
): CouponClaimState | null {
  if (result.valid) {
    if (result.is_assigned) return { kind: "claimed" }
    if (result.claimable && result.promotion) {
      return { kind: "claimable", promotionId: result.promotion.promotion_id_to_claim ?? result.promotion.id }
    }
    return { kind: "usable" }
  }

  switch (result.reason) {
    case "LOGIN_REQUIRED": {
      // code는 개별 인코딩 — &/# 포함 코드가 로그인 왕복 후 절단되지 않도록.
      const target = `/${countryCode}/coupons/claim?code=${encodeURIComponent(code)}`
      return { kind: "login", loginHref: `/${countryCode}/login?redirect_to=${encodeURIComponent(target)}` }
    }
    case "COUPON_GROUP_RESTRICTED":
      return { kind: "blocked", reason: "group_restricted" }
    case "COUPON_NOT_ASSIGNED":
      return { kind: "blocked", reason: "not_assigned" }
    default:
      // 쿠폰 카드 정보가 없는 종결 사유 → 메시지 화면
      return null
  }
}

export default async function CouponClaimPage({ params, searchParams }: PageProps) {
  const { countryCode } = await params
  const { code } = await searchParams
  const t = await getTranslations("couponClaim")

  if (!code) {
    return <ErrorState message={t("couponNotFound")} />
  }

  let result: CouponPreviewResult
  try {
    result = await previewCouponCode(code)
  } catch {
    return <ErrorState message={t("couponNotFound")} />
  }

  const state = resolveClaimState(result, countryCode, code)

  // 카드로 보여줄 쿠폰 정보가 없으면 사유 메시지만
  if (!state || !result.promotion) {
    const message =
      result.reason === "COUPON_EXPIRED" ? t("couponExpired")
      : result.reason === "COUPON_INACTIVE" ? t("couponInactive")
      : result.reason === "COUPON_NOT_STARTED" ? t("couponNotStarted")
      : result.reason === "COUPON_GROUP_RESTRICTED" ? t("couponGroupRestricted")
      : result.reason === "COUPON_NOT_ASSIGNED" ? t("couponNotAssigned")
      : t("couponNotFound")
    return <ErrorState message={message} />
  }

  const { promotion } = result
  const { discount, expires_at } = promotion

  const discountLabel = discount
    ? discount.type === "percentage"
      ? t("discountPercent", { value: discount.value })
      : t("discountAmount", { amount: discount.value.toLocaleString("ko-KR") })
    : null

  const expiryLabel = expires_at
    ? t("expiresAt", { date: formatDate(expires_at, DATE_FORMATS.KO_DOT) })
    : t("unlimited")

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
        <CouponClaimButton countryCode={countryCode} state={state} />
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
