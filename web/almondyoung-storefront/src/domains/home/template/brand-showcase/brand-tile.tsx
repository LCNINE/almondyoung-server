import LocalizedClientLink from "@/components/shared/localized-client-link"
import Image from "next/image"

interface BrandTileProps {
  name: string
  href: string
  /** 이미 URL 로 resolve 된 로고. 없으면 텍스트 타일로 폴백. */
  thumbnailUrl: string | null
}

/**
 * 홈 브랜드 스트립의 타일 하나. 관리자 권장 규격이 정사각형이라 로고도 둥근
 * 정사각형 타일에 그대로 담는다(원형은 정사각 로고 모서리가 잘려 보였다).
 * object-contain 이라 여백 있는 로고도 잘리지 않고, 로고가 없으면 브랜드명을
 * 타일 안에 그대로 보여준다(빈 이미지 자리 금지).
 */
export function BrandTile({ name, href, thumbnailUrl }: BrandTileProps) {
  return (
    <LocalizedClientLink
      href={href}
      className="flex w-[76px] flex-col items-center gap-2 transition-opacity hover:opacity-90 md:w-[92px]"
    >
      <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-white">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={name}
            fill
            sizes="(min-width: 768px) 92px, 76px"
            className="object-contain"
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
