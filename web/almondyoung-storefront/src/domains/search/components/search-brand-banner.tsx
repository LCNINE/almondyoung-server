import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ChevronRight } from "lucide-react"
import { getTranslations } from "next-intl/server"
import Image from "next/image"

interface SearchBrandBannerProps {
  name: string
  href: string
  thumbnailUrl: string | null
}

/**
 * 검색어가 브랜드관 브랜드와 매칭될 때 결과 최상단에 노출하는 브랜드 카드.
 * 클릭하면 브랜드 카테고리 페이지로 이동한다.
 */
export async function SearchBrandBanner({
  name,
  href,
  thumbnailUrl,
}: SearchBrandBannerProps) {
  const t = await getTranslations("search.brandBanner")

  return (
    <LocalizedClientLink
      href={href}
      className="mb-6 flex items-center gap-3 rounded-xl border border-border bg-white p-3 transition-colors hover:bg-muted md:gap-4 md:p-4"
    >
      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white md:h-14 md:w-14">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={name}
            fill
            sizes="56px"
            className="object-contain"
          />
        ) : (
          <span className="px-1 text-center text-[10px] leading-tight font-bold text-muted-foreground">
            {name}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold text-foreground">
          {t("title", { name })}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
          {t("hint", { name })}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-[13px] font-medium text-primary">
        <span className="hidden md:inline">{t("cta")}</span>
        <ChevronRight className="h-4 w-4" />
      </span>
    </LocalizedClientLink>
  )
}
