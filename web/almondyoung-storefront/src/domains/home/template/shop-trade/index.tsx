import { listPublicShopListings } from "@/lib/api/ugc/shop-listings"
import { getTranslations } from "next-intl/server"
import { SectionHead } from "../../components/header"
import { HomeRail } from "../../components/shared/home-rail"
import { HomeSection } from "../../components/shared/home-section"
import { ShopTradeCard } from "./shop-trade-card"

const SECTION_LIMIT = 8

export async function ShopTradeWrapper() {
  const [listings, t] = await Promise.all([
    listPublicShopListings().catch(() => []),
    getTranslations("shopTrade"),
  ])

  if (listings.length === 0) return null

  return (
    <HomeSection background="muted" className="border-t-0">
      <SectionHead
        title={t("title")}
        subtitle={t("homeDescription")}
        moreHref="/shop-trade"
        moreLabel={t("viewAll")}
      />
      <HomeRail columns="four" thumbRatio={3 / 4}>
        {listings.slice(0, SECTION_LIMIT).map((listing) => (
          <ShopTradeCard key={listing.id} listing={listing} />
        ))}
      </HomeRail>
    </HomeSection>
  )
}
