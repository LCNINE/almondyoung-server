import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { ListingCard } from "@/domains/shop-trade/components/listing-card"
import { listPublicShopListings } from "@/lib/api/pim/shop-listings"
import { ArrowRight } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { Title } from "../../components/header"
import { HomeSection } from "../../components/shared/home-section"

const SECTION_LIMIT = 8

export async function ShopTradeWrapper() {
  const [listings, t] = await Promise.all([
    listPublicShopListings().catch(() => []),
    getTranslations("shopTrade"),
  ])

  if (listings.length === 0) return null

  return (
    <HomeSection background="muted" className="border-t-0">
      <Carousel opts={{ align: "start" }} className="group/carousel w-full">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <Title>{t("title")}</Title>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("homeDescription")}
            </p>
          </div>
          <LocalizedClientLink
            href="/shop-trade"
            className="text-primary inline-flex items-center gap-1 text-sm font-semibold"
          >
            {t("viewAll")} <ArrowRight className="h-4 w-4" />
          </LocalizedClientLink>
        </div>
        <CarouselContent className="-ml-2 py-2 sm:-ml-4">
          {listings.slice(0, SECTION_LIMIT).map((listing) => (
            <CarouselItem
              key={listing.id}
              className="basis-[45%] pl-2 sm:basis-[38%] sm:pl-4 lg:basis-[25%]"
            >
              <ListingCard listing={listing} variant="grid" />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-2 hidden size-10 bg-white/90 opacity-0 shadow-md transition-opacity group-hover/carousel:opacity-100 disabled:opacity-0 md:inline-flex" />
        <CarouselNext className="right-2 hidden size-10 bg-white/90 opacity-0 shadow-md transition-opacity group-hover/carousel:opacity-100 disabled:opacity-0 md:inline-flex" />
      </Carousel>
    </HomeSection>
  )
}
