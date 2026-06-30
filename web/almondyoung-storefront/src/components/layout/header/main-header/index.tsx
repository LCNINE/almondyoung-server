import { CategoryDropdown } from "@/components/category/dropdown"
import { CategoryNavigation } from "@/components/layout/nav/category-nav"
import { LanguageSwitcher } from "@/components/layout/header/language-switcher"
import { SearchCombobox } from "@/components/search/search-combobox"
import { SearchSheet } from "@/components/search/search-sheet"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { listCategories } from "@/lib/api/medusa/categories"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { getInterestCategoryKeys } from "@lib/data/cookies"
import { getTranslations } from "next-intl/server"
import { Logo } from "./logo"
import { AccountMenu } from "./user-actions"
import { UserInfo } from "./user-info"

type Categories = Awaited<ReturnType<typeof listCategories>>

export async function MainHeader() {
  const t = await getTranslations("header.utility")
  const tCategories = await getTranslations("categories")
  const interestKeys = await getInterestCategoryKeys()
  const interestKeySet = new Set(interestKeys)

  // 사용자 선택 순서대로 앞에, 나머지는 원래 순서 유지 (노몬드는 자연스럽게 끝부분)
  const orderedInterest = interestKeys
    .map((k) => FIXED_CATEGORIES.find((c) => c.key === k))
    .filter((c): c is (typeof FIXED_CATEGORIES)[number] => Boolean(c))

  const rest = FIXED_CATEGORIES.filter((c) => !interestKeySet.has(c.key))

  const mainCategories = [...orderedInterest, ...rest].map((c) => ({
    name: tCategories(c.key),
    handle: c.handle,
    key: c.key,
    isInterest: interestKeySet.has(c.key),
  }))

  let categories: Categories = []
  try {
    categories = await listCategories({ parent_category_id: "null" })
  } catch (error) {
    console.error("[MainHeader] Failed to load categories:", error)
  }

  return (
    <header className="sticky top-0 z-40 overflow-visible bg-header-background">
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

        {/* 하단 섹션 */}
        <div className="flex items-center gap-[clamp(0.5rem,2vw,1.75rem)] md:pt-2 md:pb-4">
          {/* 데스크탑: 카테고리 드롭다운 */}
          <CategoryDropdown categories={categories} />

          <CategoryNavigation mainCategories={mainCategories} />
        </div>
      </div>

      <SearchSheet />
    </header>
  )
}
