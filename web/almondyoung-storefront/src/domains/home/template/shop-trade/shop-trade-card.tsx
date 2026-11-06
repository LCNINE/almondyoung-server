import Image from "next/image"
import { Camera, ImageIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { formatKoreanMoney } from "@/domains/shop-trade/format-money"
import type { ShopListingItem } from "@/lib/types/ui/shop-listing"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { cn } from "@/lib/utils"

export async function ShopTradeCard({ listing }: { listing: ShopListingItem }) {
  const t = await getTranslations("shopTrade")

  const photo = listing.thumbnailFileId ?? listing.imageFileIds[0] ?? null
  const photoCount = listing.imageFileIds.length
  const keyMoney = formatKoreanMoney(listing.keyMoney)
  const monthlyRent = formatKoreanMoney(listing.monthlyRent)

  const meta = [
    listing.areaPyeong ? t("pyeong", { n: listing.areaPyeong }) : null,
    `${t("keyMoneyLabel")} ${keyMoney ?? t("negotiable")}`,
    monthlyRent ? `${t("monthlyRentLabel")} ${monthlyRent}` : null,
  ].filter(Boolean)

  return (
    <LocalizedClientLink
      href={`/shop-trade/${listing.slug}`}
      className="group flex h-full flex-col gap-1.5 overflow-hidden rounded-xl bg-white"
    >
      <div className="bg-muted relative aspect-[4/3] overflow-hidden">
        {photo ? (
          <Image
            src={getThumbnailUrl(photo)}
            alt={listing.title}
            fill
            sizes="(min-width: 768px) 25vw, 42vw"
            className="object-cover"
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            <ImageIcon className="size-8" />
          </div>
        )}

        {photoCount > 1 && (
          <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-full bg-[rgba(20,22,23,0.7)] px-2 py-0.5 text-[11px] font-semibold text-white">
            <Camera className="size-3" />
            {photoCount}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5 px-3.5 pt-1.5 pb-4">
        <p className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
          {listing.dealType && (
            <span
              className={cn(
                "rounded-[5px] px-[7px] py-0.5 text-[11px] font-extrabold",
                listing.dealType === "lease"
                  ? "bg-purple-tint text-purple-deep"
                  : "bg-mint-tint text-mint-deep"
              )}
            >
              {t(`dealTypes.${listing.dealType}`)}
            </span>
          )}
          {listing.status === "closed" && (
            <span className="bg-secondary text-foreground rounded-[5px] px-[7px] py-0.5 text-[11px] font-extrabold">
              {t("closed")}
            </span>
          )}
          {listing.region && t(`regions.${listing.region}`)}
        </p>

        <p className="text-foreground line-clamp-2 min-h-[42px] text-[15px] leading-[1.4] font-bold">
          {listing.title}
        </p>

        <p className="text-foreground/80 text-[13px] font-semibold">
          {meta.join(" · ")}
        </p>

        <p className="text-gray-40 text-[12px]">
          {formatDate(listing.createdAt, DATE_FORMATS.KO_DOT)}
        </p>
      </div>
    </LocalizedClientLink>
  )
}
