import { SearchCombobox } from "@/components/search/search-combobox"
import { CategorySheet } from "@components/category/category-sheet"
import { SearchSheet } from "@components/search/search-sheet"
import { getCategoryTree } from "@lib/api/pim"
import { Menu } from "lucide-react"
import { CategoryNavigation } from "./category-navigation"
import { Logo } from "./logo"
import { UserActions } from "./user-actions"

/*─────────────────────────────────────────────────────────
 * 메인 헤더 컴포넌트
 * main header에서 사용되는 메인 헤더 컴포넌트입니다.
 * ex) 로고, 검색, 사용자 액션 버튼, 카테고리 네비게이션 등을 표시합니다.
 *───────────────────────────────────────────────────────────*/
export async function MainHeader() {
  const categories = await getCategoryTree().catch(() => null)
  const mainCategories = categories?.categories.slice(0, 7) ?? []

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
            <UserActions />
          </div>
        </div>

        {/* 하단 섹션 */}
        <nav
          aria-label="메인 카테고리"
          className="flex items-center gap-[clamp(0.5rem,2vw,1.75rem)] md:pt-2 md:pb-4"
        >
          {/* 햄버거 메뉴 */}
          <div className="hidden md:block">
            <CategorySheet
              trigger={
                <button className="flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-white/10">
                  <Menu className="h-7 w-7 text-white" />
                </button>
              }
            />
          </div>

          <CategoryNavigation mainCategories={mainCategories} />
        </nav>
      </div>

      <SearchSheet />
    </header>
  )
}
