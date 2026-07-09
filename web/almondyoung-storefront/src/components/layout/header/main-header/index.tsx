import { CategoryDropdown } from "@/components/category/dropdown"
import { LanguageSwitcher } from "@/components/layout/header/language-switcher"
import { SearchCombobox } from "@/components/search/search-combobox"
import { SearchSheet } from "@/components/search/search-sheet"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { HomeQuickLinks } from "@/domains/home/components/quick-links"
import { listCategories } from "@/lib/api/medusa/categories"
import { getTranslations } from "next-intl/server"
import { Logo } from "./logo"
import { AccountMenu } from "./user-actions"
import { MobileAuthLinks, UserInfo } from "./user-info"

type Categories = Awaited<ReturnType<typeof listCategories>>

export async function MainHeader() {
  const t = await getTranslations("header.utility")
  let categories: Categories = []

  try {
    categories = await listCategories({ parent_category_id: "null" })
  } catch (error) {
    console.error("[MainHeader] Failed to load categories:", error)
  }

  return (
    <header
      id="site-header"
      className="bg-header-background xl:border-header-border sticky top-0 z-40 overflow-visible xl:border-b"
    >
      <div className="xl:hidden">
        <div className="flex h-8 items-center justify-end gap-3 border-b border-white/10 px-3 text-[12px] text-white/85">
          <MobileAuthLinks />
          <LocalizedClientLink href="/cs">{t("support")}</LocalizedClientLink>
        </div>

        <div className="flex items-center justify-between gap-3 px-3 pt-2">
          <Logo />
          <AccountMenu />
        </div>

        <div className="px-3 pt-2 pb-3">
          <SearchCombobox inputClassName="border-primary h-10 rounded-none border-2 bg-white py-2 pr-16 pl-4 text-[13px] focus-visible:ring-0" />
        </div>
      </div>

      <div className="hidden xl:block">
        <div className="container mx-auto max-w-[1360px] px-[40px]">
          <div className="flex items-center justify-end gap-3 py-1.5 text-xs text-white/80">
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

          <div className="flex items-center gap-5">
            <div className="w-[76px] shrink-0 self-stretch">
              <CategoryDropdown categories={categories} variant="headerTile" />
            </div>

            <Logo />

            <div className="w-full max-w-3xl min-w-[300px]">
              <SearchCombobox inputClassName="border-primary rounded-none border-2 bg-white focus-visible:ring-0" />
            </div>

            <div className="shrink-0">
              <AccountMenu />
            </div>
          </div>
        </div>

        <HomeQuickLinks variant="desktopHeader" />
      </div>

      <SearchSheet />
    </header>
  )
}
