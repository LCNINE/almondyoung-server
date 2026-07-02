import { LanguageSwitcher } from "@/components/layout/header/language-switcher"
import { SearchCombobox } from "@/components/search/search-combobox"
import { SearchSheet } from "@/components/search/search-sheet"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getTranslations } from "next-intl/server"
import { Logo } from "./logo"
import { AccountMenu } from "./user-actions"
import { UserInfo } from "./user-info"

export async function MainHeader() {
  const t = await getTranslations("header.utility")

  return (
    <header className="bg-header-background sticky top-0 z-40 overflow-visible">
      <div className="container mx-auto max-w-[1360px] px-3.5 md:px-[40px]">
        <div className="hidden items-center justify-end gap-3 py-1.5 text-xs text-white/80 md:flex">
          <UserInfo />

          <LocalizedClientLink
            href="/mypage/order/list"
            className="transition-colors hover:text-white"
          >
            {t("shipping")}
          </LocalizedClientLink>

          <LocalizedClientLink
            href="/cs"
            className="transition-colors hover:text-white"
          >
            {t("support")}
          </LocalizedClientLink>

          <LanguageSwitcher />
        </div>

        {/* 상단 섹션 */}
        <div className="flex items-center justify-between gap-[clamp(0.5rem,2vw,1.75rem)] pt-2 pb-0 md:justify-normal md:py-5">
          <div>
            <Logo />
          </div>

          <div className="hidden w-full max-w-3xl min-w-[300px] md:block">
            <SearchCombobox />
          </div>

          <div className="shrink-0">
            <AccountMenu />
          </div>
        </div>
      </div>

      <SearchSheet />
    </header>
  )
}
