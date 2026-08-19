import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import Image from "next/image"

interface BrandTileProps {
  name: string
  href: string
  /** file-service fileId 또는 URL. 없으면 텍스트 타일로 폴백. */
  thumbnail: string | null
}

/**
 * 홈 브랜드 스트립의 타일 하나. 로고는 원형 안에 object-contain 으로 담아
 * 비율이 제각각인 로고도 잘리지 않게 하고, 로고가 없으면 브랜드명을
 * 원 안에 그대로 보여준다(빈 이미지 자리 금지).
 */
export function BrandTile({ name, href, thumbnail }: BrandTileProps) {
  return (
    <LocalizedClientLink
      href={href}
      className="flex w-[72px] flex-col items-center gap-2 transition-opacity hover:opacity-90 md:w-[88px]"
    >
      <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-full border border-border bg-white">
        {thumbnail ? (
          <Image
            src={getThumbnailUrl(thumbnail)}
            alt={name}
            fill
            sizes="(min-width: 768px) 88px, 72px"
            className="object-contain p-2"
          />
        ) : (
          <span className="line-clamp-2 px-1.5 text-center text-[11px] leading-tight font-bold text-muted-foreground">
            {name}
          </span>
        )}
      </span>
      <span className="line-clamp-1 w-full text-center text-[12px] leading-tight text-gray-700 md:text-[13px]">
        {name}
      </span>
    </LocalizedClientLink>
  )
}
