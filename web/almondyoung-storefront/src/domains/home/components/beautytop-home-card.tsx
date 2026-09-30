import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ChartNoAxesColumn, ChevronRight } from "lucide-react"
import { getTranslations } from "next-intl/server"

export async function BeautyTopHomeCard() {
  const t = await getTranslations("home.beautytop")

  return (
    <div className="px-4 py-4 xl:hidden">
      <LocalizedClientLink
        href="/beautytop"
        className="bg-secondary flex items-center gap-3 rounded-2xl p-4"
      >
        <span className="bg-header-background flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <ChartNoAxesColumn aria-hidden className="h-5 w-5 text-white" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-foreground flex items-center gap-1.5 text-[15px] font-bold">
            {t("title")}
            <span className="bg-primary rounded-full px-1.5 py-[3px] text-[9px] leading-none font-bold text-white">
              NEW
            </span>
          </span>
          <span className="text-muted-foreground block text-[13px]">
            {t("body")}
          </span>
        </span>
        <ChevronRight aria-hidden className="text-muted-foreground h-5 w-5" />
      </LocalizedClientLink>
    </div>
  )
}
