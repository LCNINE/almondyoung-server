import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ChartNoAxesColumn } from "lucide-react"
import { getTranslations } from "next-intl/server"

// Copy only — the home page is the busiest page, so this card reads no BeautyTop data.
export async function BeautyTopHomeCard() {
  const t = await getTranslations("home.beautytop")

  return (
    <div className="container mx-auto max-w-[1280px] px-4 pt-4 md:px-[32px] md:pt-7">
      <LocalizedClientLink
        href="/beautytop"
        className="bg-ink flex flex-wrap items-center gap-2.5 overflow-hidden rounded-xl p-[18px] text-white md:flex-nowrap md:gap-5 md:px-7 md:py-[22px]"
      >
        <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-white/75">
          <ChartNoAxesColumn className="size-4" aria-hidden />
          {t("title")}
          <span className="bg-pink text-ink inline-grid h-[18px] place-items-center rounded-full px-2 text-[10px] font-bold">
            NEW
          </span>
        </span>
        <span className="flex min-w-0 basis-full flex-col md:basis-auto">
          <span className="text-[17px] font-bold tracking-[-0.02em] break-keep md:text-xl">
            {t("headline")}
          </span>
          <span className="text-[13px] break-keep text-white/70">
            {t("body")}
          </span>
        </span>
        <span
          aria-hidden
          className="hidden h-7 shrink-0 items-end gap-1 md:flex"
        >
          <i className="bg-purple h-[40%] w-1.5 rounded-[2px]" />
          <i className="bg-pink h-[70%] w-1.5 rounded-[2px]" />
          <i className="bg-mint h-full w-1.5 rounded-[2px]" />
        </span>
        <span className="text-ink flex h-10 shrink-0 items-center rounded-full bg-white px-[18px] text-sm font-bold md:ml-auto">
          {t("cta")}
        </span>
      </LocalizedClientLink>
    </div>
  )
}
