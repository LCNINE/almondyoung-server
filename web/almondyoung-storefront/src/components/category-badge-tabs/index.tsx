import React from "react"
import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import { getShowOnMainCategory } from "@lib/utils/category-display-settings"

// --- 반응형 스타일 변수 ---

// 공통 스타일:
const baseTagStyle = `
  flex items-center justify-center gap-2.5 rounded-full 
  px-2.5 py-1 text-sm 
  md:px-3.5 md:py-2 md:text-base 
  outline outline-[0.50px] outline-offset-[-0.50px] 
  border-gray-200
  font-['Pretendard'] transition-colors
  whitespace-nowrap
`
// 비활성 스타일:
const inactiveTagStyle = `
  outline-muted text-muted-foreground font-normal
  hover:bg-gray-100
`
// 활성 스타일:
const activeTagStyle = `
  bg-black outline-black text-white font-normal
  md:bg-black md:outline-black md:font-bold
`

interface CategoryBadgeTabsProps {
  categories: CategoryTreeNodeDto[]
  initialCategoryId?: string | "first" // "first"면 첫 번째 카테고리, 특정 ID면 해당 카테고리
  onCategorySelect?: (categoryId: string) => void
}

export function CategoryBadgeTabs({
  categories,
  initialCategoryId = "first",
  onCategorySelect,
}: CategoryBadgeTabsProps) {
  // 카테고리 트리에서 실제 표시할 카테고리 추출
  const displayCategories = React.useMemo(() => {
    if (categories.length === 0) return []

    const level0Categories = categories.filter((category) => {
      if (category.level !== 0) return false
      if (category.isActive === false) return false
      if (!getShowOnMainCategory(category)) return false
      return true
    })

    return level0Categories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }, [categories])

  // 초기 카테고리 ID 결정
  const defaultCategoryId = initialCategoryId === "first"
    ? displayCategories[0]?.id ?? ""
    : initialCategoryId

  // 선택된 카테고리 상태
  const [activeCategoryId, setActiveCategoryId] = React.useState<string>(defaultCategoryId)

  // displayCategories가 로드되면 초기값 설정
  React.useEffect(() => {
    if (displayCategories.length > 0 && !activeCategoryId) {
      const targetId = initialCategoryId === "first"
        ? displayCategories[0].id
        : initialCategoryId
      setActiveCategoryId(targetId)
    }
  }, [displayCategories, initialCategoryId, activeCategoryId])

  const handleCategoryClick = (categoryId: string) => {
    setActiveCategoryId(categoryId)
    onCategorySelect?.(categoryId)
  }

  if (displayCategories.length === 0) {
    return null
  }

  return (
    <nav aria-label="카테고리 필터" className="w-full">
      <ul className="scrollbar-hide flex flex-nowrap items-center gap-[5px] overflow-x-auto md:flex-wrap md:gap-1.5 md:overflow-x-visible">
        {displayCategories.map((category) => (
          <li key={category.id} className="flex-shrink-0">
            <button
              type="button"
              onClick={() => handleCategoryClick(category.id)}
              className={` ${baseTagStyle} ${activeCategoryId === category.id ? activeTagStyle : inactiveTagStyle} `}
              aria-pressed={activeCategoryId === category.id}
            >
              {category.name}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// 기본 export로도 사용 가능하도록 별칭 제공
export default CategoryBadgeTabs
