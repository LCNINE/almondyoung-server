import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { listPublicShopListings } from "@/lib/api/pim/shop-listings"
import type { ShopListingItem } from "@/lib/types/ui/shop-listing"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"

const MAX_ITEMS = 6

export async function RelatedListings({
  current,
}: {
  current: ShopListingItem
}) {
  const t = await getTranslations("shopTrade")

  let all: ShopListingItem[] = []
  try {
    all = await listPublicShopListings()
  } catch (error) {
    console.error("[shop-trade] failed to load related listings:", error)
    return null
  }

  const others = all.filter((listing) => listing.id !== current.id)

  // 같은 지역 매물이 하나도 없을 때만 전체 최신으로 폴백한다 (제목도 같이 바뀜)
  const sameRegion = current.region
    ? others.filter((listing) => listing.region === current.region)
    : []
  const items = (sameRegion.length > 0 ? sameRegion : others).slice(0, MAX_ITEMS)

  if (items.length === 0) return null

  const regionLabel =
    sameRegion.length > 0 && current.region
      ? t(`regions.${current.region}`)
      : null

  return (
    <section className="border-border mt-10 border-t pt-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-foreground text-base font-bold">
          {regionLabel
            ? t("relatedInRegion", { region: regionLabel })
            : t("relatedAll")}
        </h2>
        <LocalizedClientLink
          href={
            regionLabel ? `/shop-trade?region=${current.region}` : "/shop-trade"
          }
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          {t("viewAll")}
        </LocalizedClientLink>
      </div>

      <ul className="divide-border divide-y border-y">
        {items.map((listing) => (
          <li key={listing.id}>
            <LocalizedClientLink
              href={`/shop-trade/${listing.slug}`}
              className="hover:bg-muted/60 flex items-center gap-2 py-2.5 transition-colors"
            >
              {listing.region && (
                <span className="text-primary shrink-0 text-xs">
                  [{t(`regions.${listing.region}`)}]
                </span>
              )}
              <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                {listing.title}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {formatDate(listing.createdAt, DATE_FORMATS.KO_DOT)}
              </span>
            </LocalizedClientLink>
          </li>
        ))}
      </ul>
    </section>
  )
}
