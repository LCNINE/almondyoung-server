import LocalizedClientLink from "@/components/shared/localized-client-link"
import ThumbnailImage from "@/domains/products/components/thumbnail/thumbnail-image"
import { ProductMembershipBadge } from "@/components/shared/badges/product-membership-badge"
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

      {/* 글자 규격은 라이브 상품 카드(prodcut-card/parts/product-info)와 같게 둔다 */}
      <p
        className={cn(
          "line-clamp-1 leading-tight text-gray-600",
          compact ? "text-[13px]" : "text-[14px]"
        )}
      >
        {item.title}
      </p>

      <p className="text-[16px] leading-none font-bold text-black tabular-nums">
        {formatPrice(item.price)}원
      </p>

      {item.membershipPrice !== null && (
        <div className="text-primary flex flex-col gap-0.5">
          <ProductMembershipBadge size="sm" label={t("membership")} />
          <span className="text-[15px] font-bold tabular-nums">
            {formatPrice(item.membershipPrice)}원
          </span>
        </div>
      )}
    </LocalizedClientLink>
  )
}
