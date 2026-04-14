import { MegaMenu } from "@/components/category/mega-menu"
import { CategoryNavigation } from "@/components/layout/nav/category-nav"
import { SearchCombobox } from "@/components/search/search-combobox"
import { SearchSheet } from "@/components/search/search-sheet"
import { listCategories } from "@/lib/api/medusa/categories"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { Logo } from "./logo"
import { AccountMenu } from "./user-actions"

export async function MainHeader() {
  const mainCategories = FIXED_CATEGORIES

  const categories = await listCategories({ parent_category_id: "null" })

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
          {/* 데스크탑: 메가메뉴 */}
          <MegaMenu categories={categories} />

          <CategoryNavigation mainCategories={mainCategories} />
        </div>
      </div>

      <SearchSheet />
    </header>
  )
}
