import { getMyPromotions } from "@/lib/api/medusa/promotion"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type { Promotion } from "@/lib/types/ui/promotion"
import { CouponCard } from "./coupon-card"

function formatDiscount(promo: Promotion) {
  const m = promo.application_method
  if (!m) return ""
  if (m.type === "percentage") return `${m.value}% 할인`
  return `${m.value.toLocaleString("ko-KR")}원 할인`
}

export function formatExpiry(promo: Promotion) {
  if (!promo.campaign?.ends_at) return "기간 무제한"
  return `~ ${formatDate(promo.campaign.ends_at, DATE_FORMATS.KO_DOT)}`
}

export async function CouponTemplate() {
  const data = await getMyPromotions({ limit: 50 }).catch(() => ({
    promotions: [],
    count: 0,
    offset: 0,
    limit: 50,
  }))

  const coupons = data.promotions as Promotion[]

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-10">
      <header className="mb-6 flex items-end justify-between">
        <h1 className="text-xl font-bold text-stone-900 md:text-2xl">내 쿠폰</h1>
        <p className="text-sm text-stone-500">
          총{" "}
          <span className="font-semibold text-stone-800">{coupons.length}</span>장
        </p>
      </header>

      {coupons.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50 p-10 text-center">
          <p className="text-base font-medium text-stone-500">보유한 쿠폰이 없어요</p>
          <p className="mt-1 text-sm text-stone-400">이벤트나 프로모션으로 쿠폰을 받아보세요.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {coupons.map((promo) => (
            <CouponCard key={promo.id} promo={promo} expiry={formatExpiry(promo)} />
          ))}
        </ul>
      )}
    </section>
  )
}
