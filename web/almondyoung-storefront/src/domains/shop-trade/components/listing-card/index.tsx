import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import type { ShopListingItem } from "@/lib/types/ui/shop-listing"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"
import { formatKoreanMoney } from "../../format-money"
import { CardThumbnail } from "./card-thumbnail"

export async function ListingCard({
  listing,
  variant,
}: {
  listing: ShopListingItem
  variant: "grid" | "list"
}) {
  const t = await getTranslations("shopTrade")
  const isList = variant === "list"

  const keyMoney = formatKoreanMoney(listing.keyMoney)
  const monthlyRent = formatKoreanMoney(listing.monthlyRent)

  const specs = [
    listing.areaPyeong ? t("pyeong", { n: listing.areaPyeong }) : null,
    `${t("keyMoneyLabel")} ${keyMoney ?? t("negotiable")}`,
    monthlyRent ? `${t("monthlyRentLabel")} ${monthlyRent}` : null,
  ].filter(Boolean)

  const tags = [
    listing.region ? t(`regions.${listing.region}`) : null,
    listing.businessType ? t(`businessTypes.${listing.businessType}`) : null,
  ].filter(Boolean)

  return (
    <LocalizedClientLink
      href={`/shop-trade/${listing.slug}`}
      className={cn(
        "group",
        isList ? "flex items-center gap-4 py-4" : "block"
      )}
    >
      <div
        className={cn(
          "bg-muted relative shrink-0 overflow-hidden",
          isList
            ? "aspect-[4/3] w-28 rounded-lg sm:w-40"
            : "aspect-[4/3] w-full rounded-xl"
        )}
      >
        <CardThumbnail
          images={listing.images}
          fallbackFileId={listing.thumbnailFileId}
          alt={listing.title}
          sizes={
            isList
              ? "(min-width: 640px) 160px, 112px"
              : "(min-width: 1280px) 320px, (min-width: 768px) 33vw, 50vw"
          }
          enableHover={!isList}
        />

        {listing.dealType && (
          <span className="bg-foreground/75 absolute top-2 left-2 rounded px-1.5 py-0.5 text-[11px] font-medium text-white">
            {t(`dealTypes.${listing.dealType}`)}
          </span>
        )}
      </div>

      <div className={cn("min-w-0", isList ? "flex-1" : "mt-2")}>
        {tags.length > 0 && (
          <p className="text-muted-foreground text-xs">{tags.join(" · ")}</p>
        )}

        <h2 className="text-foreground mt-0.5 line-clamp-1 text-sm font-medium sm:text-base">
          {listing.title}
        </h2>

        <p className="text-foreground mt-1 text-sm font-semibold">
          {specs.join(" · ")}
        </p>

        <p className="text-muted-foreground mt-1 text-xs">
          {formatDate(listing.createdAt, DATE_FORMATS.KO_DOT)}
        </p>
      </div>
    </LocalizedClientLink>
  )
}
