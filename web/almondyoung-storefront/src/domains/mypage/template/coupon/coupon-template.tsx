import { claimCoupon, getMyPromotions } from "@/lib/api/medusa/promotion"
import type { Promotion } from "@/lib/types/ui/promotion"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { getTranslations } from "next-intl/server"
import { CouponCard } from "./coupon-card"

export async function formatExpiry(promo: Promotion) {
  const t = await getTranslations("mypage.coupon")
  if (!promo.campaign?.ends_at) return t("unlimited")
  return `~ ${formatDate(promo.campaign.ends_at, DATE_FORMATS.KO_DOT)}`
}

export async function CouponTemplate() {
  const t = await getTranslations("mypage.coupon")
  const data = await getMyPromotions({ limit: 50 }).catch(() => ({
    promotions: [],
    claimable_promotions: [],
    count: 0,
    offset: 0,
    limit: 50,
  }))

  const coupons = data.promotions as Promotion[]
  const claimableCoupons = (data.claimable_promotions ?? []) as Promotion[]
  const assignedCoupons = coupons.filter((p) => p.is_assigned)
  const publicCoupons = coupons.filter((p) => !p.is_assigned)

  const allForExpiry = [...coupons, ...claimableCoupons]
  const expiryById = new Map(
    await Promise.all(allForExpiry.map(async (p) => [p.id, await formatExpiry(p)] as const))
  )

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-10">
      <header className="mb-6 flex items-end justify-between">
        <h1 className="text-xl font-bold text-stone-900 md:text-2xl">
          {t("myCoupons")}
        </h1>
        <p className="text-sm text-stone-500">
          {t.rich("totalCount", {
            count: assignedCoupons.length,
            strong: (chunks) => (
              <span className="font-semibold text-stone-800">{chunks}</span>
            ),
          })}
        </p>
      </header>

      {assignedCoupons.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50 p-10 text-center">
          <p className="text-base font-medium text-stone-500">
            {t("emptyTitle")}
          </p>
          <p className="mt-1 text-sm text-stone-400">{t("emptyDescription")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {assignedCoupons.map((promo) => (
            <CouponCard
              key={promo.id}
              promo={promo}
              expiry={expiryById.get(promo.id) ?? ""}
            />
          ))}
        </ul>
      )}

      {claimableCoupons.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-stone-500">
            {t("claimSection")}
          </h2>
          <ul className="flex flex-col gap-3">
            {claimableCoupons.map((promo) => (
              <CouponCard
                key={promo.id}
                promo={promo}
                expiry={expiryById.get(promo.id) ?? ""}
                onClaim={claimCoupon.bind(null, promo.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {publicCoupons.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-stone-500">
            {t("publicSection")}
          </h2>
          <ul className="flex flex-col gap-3">
            {publicCoupons.map((promo) => (
              <CouponCard
                key={promo.id}
                promo={promo}
                expiry={expiryById.get(promo.id) ?? ""}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
