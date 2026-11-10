import LocalizedClientLink from "@/components/shared/localized-client-link"
import ThumbnailImage from "@/domains/products/components/thumbnail/thumbnail-image"
import { filterSoldOut } from "@/domains/products/components/product-card/quantity/stock-status"
import { listProducts } from "@/lib/api/medusa/products"
import { getIsMembershipCustomer } from "@/lib/data/membership"
import { filterProductsByMembershipVisibility } from "@/lib/utils/product-card"
import { formatPrice } from "@/lib/utils/price-utils"
import { getTranslations } from "next-intl/server"
import { HomeSection } from "../../components/shared/home-section"
import {
  pickBiggestMemberSavings,
  toV1CardItems,
} from "../../components/v1-card/v1-card-data"
import { resolveCategoryIds } from "../resolve-category-ids"

/** 반영구 > 머신, 타투 > 머신 */
export const MEMBER_SAVINGS_CATEGORY_HANDLES = [
  "cafe24-cat-265",
  "cafe24-cat-275",
] as const

const LIMIT = 4
const FETCH_LIMIT = 60

export async function MemberSavingsWrapper({
  countryCode,
}: {
  countryCode: string
}) {
  const [categoryIds, isMember, t] = await Promise.all([
    resolveCategoryIds(MEMBER_SAVINGS_CATEGORY_HANDLES),
    getIsMembershipCustomer(),
    getTranslations("home.memberSavings"),
  ])

  if (categoryIds.length === 0) return null

  const {
    response: { products },
  } = await listProducts({
    countryCode,
    queryParams: { category_id: categoryIds, limit: FETCH_LIMIT },
  })

  const visible = filterProductsByMembershipVisibility(
    filterSoldOut(products),
    isMember
  )
  const items = pickBiggestMemberSavings(
    toV1CardItems(visible, isMember),
    LIMIT
  )

  if (items.length === 0) return null

  return (
    <HomeSection className="border-t-0">
      <div className="bg-purple-tint relative grid items-center gap-6 overflow-hidden rounded-[24px] p-6 md:p-10 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-10">
        <svg
          viewBox="0 0 400 400"
          aria-hidden
          className="pointer-events-none absolute -bottom-[110px] -left-[60px] w-[340px] opacity-[0.16]"
        >
          <path
            d="M70 360 L200 60 L330 360"
            fill="none"
            strokeWidth="40"
            className="stroke-mint"
          />
          <path
            d="M118 150 L200 232 L282 150 M200 232 L200 372"
            fill="none"
            strokeWidth="40"
            className="stroke-pink"
          />
        </svg>

        <div className="relative z-1 flex flex-col gap-3.5">
          <h2 className="text-ink text-[24px] leading-[1.3] font-bold tracking-[-0.01em] md:text-[28px]">
            {t("titleLine1")}
            <br />
            {t("titleLine2")}
          </h2>
          <p className="text-ink/80 text-[15px]">{t("description")}</p>
          <LocalizedClientLink
            href="/mypage/membership"
            className="bg-purple-deep mt-2 inline-flex h-[52px] items-center self-start rounded-xl px-6 text-[15px] font-bold text-white"
          >
            {isMember ? t("myMembership") : t("join")}
          </LocalizedClientLink>
        </div>

        <ul className="relative z-1 -mx-6 grid snap-x snap-mandatory scroll-px-6 auto-cols-[46%] grid-flow-col gap-3 overflow-x-auto px-6 [scrollbar-width:none] md:mx-0 md:grid-flow-row md:grid-cols-4 md:gap-3.5 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden [&>li]:snap-start">
          {items.map((item) => (
            <li key={item.id} className="min-w-0">
              <LocalizedClientLink
                href={`/products/${item.handle}`}
                className="flex h-full flex-col gap-2.5 rounded-2xl bg-white p-3"
              >
                <span className="bg-muted relative block aspect-square overflow-hidden rounded-[10px]">
                  {item.imageSrc && (
                    <ThumbnailImage image={item.imageSrc} size="square" />
                  )}
                </span>
                <span className="flex flex-col">
                  <span className="text-ink line-clamp-2 min-h-9 text-[13px] leading-[1.4]">
                    {item.title}
                  </span>
                  <span className="text-muted-foreground mt-1 text-[13px] tabular-nums line-through">
                    {formatPrice(item.regularPrice)}원
                  </span>
                  <span className="text-purple-deep text-lg font-bold tabular-nums">
                    {formatPrice(item.membershipPrice)}원
                  </span>
                  <span className="text-pink-deep mt-1 text-xs font-bold">
                    {t("saving", { amount: formatPrice(item.saving) })}
                  </span>
                </span>
              </LocalizedClientLink>
            </li>
          ))}
        </ul>
      </div>
    </HomeSection>
  )
}
