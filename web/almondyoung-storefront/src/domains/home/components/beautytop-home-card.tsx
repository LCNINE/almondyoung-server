import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ChevronRight } from "lucide-react"
import { getTranslations } from "next-intl/server"

// Copy only — the home page is the busiest page, so this card reads no BeautyTop data.
export async function BeautyTopHomeCard() {
  const t = await getTranslations("home.beautytop")

  return (
    <div className="container mx-auto max-w-[1360px] px-4 py-4 md:px-[40px] xl:py-6">
      <LocalizedClientLink
        href="/beautytop"
        className="group flex items-center gap-3.5 rounded-2xl bg-zinc-900 px-4 py-[18px] text-white transition-colors duration-150 hover:bg-zinc-800 xl:gap-6 xl:px-8 xl:py-6"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 xl:flex-row xl:items-center xl:gap-6">
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-white/70 xl:text-[13px]">
            {t("title")}
            <span className="bg-primary rounded-full px-1.5 py-[3px] text-[10px] leading-none font-bold text-white">
              NEW
            </span>
          </span>
          <span className="flex min-w-0 flex-col gap-1.5 xl:flex-row xl:items-baseline xl:gap-4">
            <span className="text-[19px] leading-[26px] font-bold break-keep xl:text-[22px]">{t("headline")}</span>
            <span className="text-[13px] leading-[19px] break-keep text-white/75 xl:text-[15px]">{t("body")}</span>
          </span>
        </span>
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 xl:hidden"
        >
          <ChevronRight className="h-[18px] w-[18px]" />
        </span>
        <span className="hidden h-11 shrink-0 items-center rounded-full bg-white px-5 text-[15px] font-bold text-zinc-900 xl:flex">
          {t("cta")}
        </span>
      </LocalizedClientLink>
    </div>
  )
}
