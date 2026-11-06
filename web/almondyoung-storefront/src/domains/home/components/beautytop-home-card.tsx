import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ChevronRight } from "lucide-react"
import { getTranslations } from "next-intl/server"

// Copy only — the home page is the busiest page, so this card reads no BeautyTop data.
export async function BeautyTopHomeCard() {
  const t = await getTranslations("home.beautytop")

  return (
    <div className="container mx-auto max-w-[1280px] px-4 py-5 md:px-[32px] md:py-8">
      <LocalizedClientLink
        href="/beautytop"
        className="text-ink flex items-center gap-3.5 rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:bg-gray-50 md:gap-4 md:px-6 md:py-5"
      >
        <span
          aria-hidden
          className="bg-mint-tint flex size-11 shrink-0 items-end justify-center gap-[3px] rounded-xl pb-3 md:size-12"
        >
          <i className="bg-purple h-2 w-[5px] rounded-[2px]" />
          <i className="bg-pink h-3.5 w-[5px] rounded-[2px]" />
          <i className="bg-mint h-5 w-[5px] rounded-[2px]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-gray-500">
            {t("title")}
            <span className="bg-pink-tint text-pink-deep rounded-[4px] px-1.5 py-px text-[10px] font-bold">
              NEW
            </span>
          </span>
          <span className="text-base font-bold tracking-[-0.02em] break-keep md:text-[17px]">
            {t("headline")}
          </span>
          <span className="hidden text-[13px] break-keep text-gray-500 md:block">
            {t("body")}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-gray-500">
          <span className="hidden md:inline">{t("cta")}</span>
          <ChevronRight className="size-5" aria-hidden />
        </span>
      </LocalizedClientLink>
    </div>
  )
}
