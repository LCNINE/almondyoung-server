import { getMyPromotions } from "@/lib/api/medusa/promotion"
import type { Promotion } from "@/lib/types/ui/promotion"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { getTranslations } from "next-intl/server"
import { CouponTabs, type CouponItem } from "./coupon-tabs"

export async function formatExpiry(promo: Promotion) {
  const t = await getTranslations("mypage.coupon")
  if (!promo.campaign?.ends_at) return t("unlimited")
  return `~ ${formatDate(promo.campaign.ends_at, DATE_FORMATS.KO_DOT)}`
}

export async function CouponTemplate() {
  const t = await getTranslations("mypage.coupon")
  // API 실패를 빈 목록으로 삼키지 않는다 — 인증/서버 오류는 error.tsx로 전파해
  // 토큰 복구 또는 에러 화면을 띄운다("쿠폰 없음" 오표기 방지).
  const data = await getMyPromotions({ limit: 50 })

  const coupons = (data.promotions ?? []) as Promotion[]
  const claimableCoupons = (data.claimable_promotions ?? []) as Promotion[]
  const expiredCoupons = (data.expired_promotions ?? []) as Promotion[]

  // 내 쿠폰 = 사용 가능한 쿠폰(발급받은 것 + 공개 쿠폰)
  const mineCoupons = coupons

  // 만료일 문자열을 서버에서 미리 계산해 클라이언트로 넘긴다.
  const withExpiry = async (list: Promotion[]): Promise<CouponItem[]> =>
    Promise.all(list.map(async (promo) => ({ promo, expiry: await formatExpiry(promo) })))

  const [mine, claimable, expired] = await Promise.all([
    withExpiry(mineCoupons),
    withExpiry(claimableCoupons),
    withExpiry(expiredCoupons),
  ])

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-10">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-stone-900 md:text-2xl">{t("myCoupons")}</h1>
      </header>

      <CouponTabs mine={mine} claimable={claimable} expired={expired} />
    </section>
  )
}
