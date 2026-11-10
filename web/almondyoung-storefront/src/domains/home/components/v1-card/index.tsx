import LocalizedClientLink from "@/components/shared/localized-client-link"
import ThumbnailImage from "@/domains/products/components/thumbnail/thumbnail-image"
import { cn } from "@/lib/utils"
import { formatPrice } from "@/lib/utils/price-utils"
import { useTranslations } from "next-intl"
import type { V1CardItem } from "./v1-card-data"

export type { V1CardItem } from "./v1-card-data"

interface V1ProductCardProps {
  item: V1CardItem
  /** 썸네일 왼쪽 위 mint 태그 (예: 신상) */
  tag?: string
  /** 6칸 줄처럼 좁은 칸에서 글자를 한 단계 줄인다 */
  compact?: boolean
}

export function V1ProductCard({ item, tag, compact }: V1ProductCardProps) {
  const t = useTranslations("home.v1Card")

  return (
    <LocalizedClientLink
      href={`/products/${item.handle}`}
      className="group flex flex-col gap-1.5"
    >
      <div className="bg-muted relative mb-1.5 aspect-square overflow-hidden rounded-[14px] [&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-[1.03]">
        {item.imageSrc && (
          <ThumbnailImage image={item.imageSrc} size="square" />
        )}
        {tag && (
          <span className="bg-mint text-ink absolute top-2.5 left-2.5 grid h-6 place-items-center rounded-[7px] px-2 text-xs font-bold">
            {tag}
          </span>
        )}
      </div>

      <p
        className={cn(
          "text-ink line-clamp-2 leading-[1.4] font-normal",
          compact ? "min-h-9 text-[13px]" : "min-h-10 text-sm"
        )}
      >
        {item.title}
      </p>

      <p
        className={cn(
          "text-ink leading-normal font-bold tabular-nums",
          compact ? "text-[15px]" : "text-base"
        )}
      >
        {formatPrice(item.price)}원
      </p>

      {item.membershipPrice !== null && (
        <p className="text-purple-deep text-[13px] font-bold tabular-nums">
          <span className="bg-purple-tint mr-0.5 inline-block h-5 rounded-[5px] px-1.5 text-[11px] leading-5">
            {t("membership")}
          </span>
          {formatPrice(item.membershipPrice)}원
        </p>
      )}
    </LocalizedClientLink>
  )
}
