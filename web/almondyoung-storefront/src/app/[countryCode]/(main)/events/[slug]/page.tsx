import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { getCouponEvent, type CouponEventCoupon, type CouponEventResult } from "@/lib/api/medusa/store"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import {
  CouponClaimButton,
  type CouponClaimState,
  type CouponBlockReason,
} from "@/app/[countryCode]/(main)/coupons/claim/_components/coupon-claim-button"

interface PageProps {
  params: Promise<{ countryCode: string; slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  try {
    const { event } = await getCouponEvent(slug)
    return { title: event.title }
  } catch {
    return { title: "" }
  }
}

function toButtonState(c: CouponEventCoupon): CouponClaimState {
  switch (c.state.kind) {
    case "claimable":
      return { kind: "claimable", promotionId: c.promotion_id }
    case "claimed":
      return { kind: "claimed" }
    case "usable":
      return { kind: "usable" }
    default:
      return { kind: "blocked", reason: (c.state.reason ?? "inactive") as CouponBlockReason }
  }
}

export default async function CouponEventPage({ params }: PageProps) {
  const { countryCode, slug } = await params
  const t = await getTranslations("couponClaim")

  let data: CouponEventResult
  try {
    data = await getCouponEvent(slug)
  } catch {
    notFound()
  }

  const { event, coupons } = data

  const discountLabel = (c: CouponEventCoupon) => {
    if (!c.discount) return null
    return c.discount.type === "percentage"
      ? t("discountPercent", { value: c.discount.value })
      : t("discountAmount", { amount: c.discount.value.toLocaleString("ko-KR") })
  }
  const expiryLabel = (c: CouponEventCoupon) =>
    c.expires_at ? t("expiresAt", { date: formatDate(c.expires_at, DATE_FORMATS.KO_DOT) }) : t("unlimited")

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8">
      {event.banner_image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.banner_image_url}
          alt={event.title}
          className="mb-5 w-full rounded-2xl border object-cover"
        />
      )}

      <header className="mb-6 space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{event.title}</h1>
        {event.description && (
          <p className="whitespace-pre-line text-sm text-muted-foreground">{event.description}</p>
        )}
      </header>

      <ul className="space-y-3">
        {coupons.map((c) => (
          <li
            key={c.promotion_id}
            className="overflow-hidden rounded-2xl border bg-white shadow-sm"
          >
            <div className="h-1.5 bg-primary" />
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1">
                {discountLabel(c) && (
                  <p className="text-2xl font-bold tracking-tight">{discountLabel(c)}</p>
                )}
                <p className="font-mono text-xs text-muted-foreground">{c.code}</p>
                <p className="text-xs text-muted-foreground">{expiryLabel(c)}</p>
              </div>
              <div className="w-32 shrink-0">
                <CouponClaimButton countryCode={countryCode} state={toButtonState(c)} compact />
              </div>
            </div>
          </li>
        ))}
      </ul>

      {coupons.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("couponNotFound")}</p>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">{t("hint")}</p>
    </div>
  )
}
