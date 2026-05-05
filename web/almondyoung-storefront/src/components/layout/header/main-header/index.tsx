import { CategoryDropdown } from "@/components/category/dropdown"
import { CategoryNavigation } from "@/components/layout/nav/category-nav"
import { SearchCombobox } from "@/components/search/search-combobox"
import { SearchSheet } from "@/components/search/search-sheet"
import { listCategories } from "@/lib/api/medusa/categories"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { getInterestCategoryKeys } from "@lib/data/cookies"
import { Logo } from "./logo"
import { AccountMenu } from "./user-actions"

type Categories = Awaited<ReturnType<typeof listCategories>>

export async function MainHeader() {
  const interestKeys = await getInterestCategoryKeys()
  const interestKeySet = new Set(interestKeys)

  // 사용자 선택 순서대로 앞에, 나머지는 원래 순서 유지 (노몬드는 자연스럽게 끝부분)
  const orderedInterest = interestKeys
    .map((k) => FIXED_CATEGORIES.find((c) => c.key === k))
    .filter((c): c is (typeof FIXED_CATEGORIES)[number] => Boolean(c))

  const rest = FIXED_CATEGORIES.filter((c) => !interestKeySet.has(c.key))

  const mainCategories = [...orderedInterest, ...rest].map((c) => ({
    name: c.name,
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
    <header className="bg-header-background overflow-visible">
      <div className="container mx-auto max-w-[1360px] px-3.5 md:px-[40px]">
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
