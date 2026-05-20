import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import Image from "next/image"

export type CategoryThumbnailVariant = "circle" | "square"

interface CategoryThumbnailProps {
  name: string
  href: string
  /** 이미 resolve 된 썸네일 소스(file id 또는 URL). 없으면 이름 텍스트로 폴백. */
  imageUrl: string | null
  /** circle: 원형(카테고리 페이지 SubCategoryNav), square: 사각 그리드(모바일 시트) */
  variant?: CategoryThumbnailVariant
  /** next/image sizes 힌트 */
  sizes?: string
  /** 시트 등에서 클릭 시 닫기 콜백 */
  onNavigate?: () => void
  className?: string
}

export function CategoryThumbnail({
  name,
  href,
  imageUrl,
  variant = "square",
  sizes = "96px",
  onNavigate,
  className,
}: CategoryThumbnailProps) {
  const isCircle = variant === "circle"

  return (
    <LocalizedClientLink
      href={href}
      onClick={onNavigate}
      className={cn("flex flex-col items-center gap-2", className)}
    >
      <div
        className={cn(
          "relative overflow-hidden",
          isCircle
            ? "h-24 w-24 rounded-full bg-gray-200"
            : "aspect-square w-full rounded-lg bg-gray-100"
        )}
      >
        {imageUrl ? (
          <Image
            src={getThumbnailUrl(imageUrl)}
            alt={name}
            fill
            sizes={sizes}
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-1 text-center">
            <span className="text-[10px] leading-tight text-gray-300">
              {name}
            </span>
          </div>
        )}
      </div>
      <span
        className={cn(
          "text-center text-gray-700",
          isCircle
            ? "text-sm"
            : "line-clamp-2 text-[11.5px] leading-tight"
        )}
      >
        {name}
      </span>
    </LocalizedClientLink>
  )
}
