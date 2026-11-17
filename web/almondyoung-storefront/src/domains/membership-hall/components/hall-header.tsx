import Image from "next/image"
import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"

export const MEMBERSHIP_PAGE_HREF = "/mypage/membership"

export async function HallHeader({ isMember }: { isMember: boolean }) {
  const t = await getTranslations("membershipHall")

  return (
    <div className="bg-purple-tint flex flex-wrap items-center gap-3 rounded-2xl p-5 md:flex-nowrap md:gap-5 md:px-8 md:py-7">
      <Image
        src="/images/almondyoung-symbol.png"
        alt=""
        aria-hidden
        width={56}
        height={56}
        className="size-11 flex-none object-contain md:size-14"
      />
      <div className="min-w-0 flex-1">
        <h1 className="text-ink text-[22px] font-bold tracking-[-0.01em] md:text-[28px]">
          {t("title")}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("description")}</p>
      </div>
      <LocalizedClientLink
        href={MEMBERSHIP_PAGE_HREF}
        className="bg-purple-deep flex h-12 w-full flex-none items-center justify-center rounded-xl px-[22px] text-[15px] font-bold text-white md:w-auto"
      >
        {isMember ? t("myMembership") : t("join")}
      </LocalizedClientLink>
    </div>
  )
}
