import React from "react"
import type { CategoryTreeNode } from "@lib/api/pim/pim-types"
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
  outline-Grays-Gray-3 text-Grays-Gray font-normal
  hover:bg-gray-100
`
// 활성 스타일:
const activeTagStyle = `
  bg-black outline-black text-zinc-100 font-normal
  md:bg-zinc-800 md:outline-zinc-800 md:font-bold
`

interface CategoryBadgeTabsProps {
  categories: CategoryTreeNode[]
  selectedCategoryId?: string | null
  onCategorySelect?: (categoryId: string) => void
}

export function CategoryBadgeTabs({
  categories,
  selectedCategoryId,
  onCategorySelect,
}: CategoryBadgeTabsProps) {
  // 카테고리 트리에서 실제 표시할 카테고리 추출
  // level 0인 카테고리만 필터링
  // showOnMainCategory가 true인 카테고리만 가져오기
  const displayCategories = React.useMemo(() => {
    if (categories.length === 0) return []
    
    // level 0인 카테고리만 필터링
    const level0Categories = categories.filter((category) => {
      // level이 0인 것만
      if (category.level !== 0) return false
      
      // isActive가 false인 것은 제외
      if (category.isActive === false) return false
      
      // showOnMainCategory가 true인 것만 (display_settings에서 파싱)
      if (!getShowOnMainCategory(category)) return false
      
      return true
    })
    
    // sortOrder로 정렬
    return level0Categories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }, [categories])

  // 초기 선택 카테고리 설정
  const [activeCategoryId, setActiveCategoryId] = React.useState<string>(() => {
    if (selectedCategoryId) return selectedCategoryId
    if (displayCategories.length > 0) return displayCategories[0].id
    return ""
  })

  // selectedCategoryId가 변경되면 내부 상태도 업데이트
  React.useEffect(() => {
    if (selectedCategoryId !== undefined && selectedCategoryId !== null) {
      setActiveCategoryId(selectedCategoryId)
    }
  }, [selectedCategoryId])

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
