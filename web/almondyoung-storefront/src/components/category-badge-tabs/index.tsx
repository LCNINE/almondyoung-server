import React from "react" // (상태 관리를 위해 import)
// (tailwind-scrollbar-hide 플러그인이 설치되어 있다고 가정합니다)

// --- 1. 데이터 분리 (DRY 원칙) ---
const categories = [
  { id: "hair", label: "헤어" },
  { id: "nail", label: "네일" },
  { id: "permanent-makeup", label: "반영구" },
  { id: "eyelash", label: "속눈썹" },
  { id: "waxing", label: "왁싱" },
  { id: "tattoo", label: "타투" },
  { id: "skin-care", label: "피부미용" },
  { id: "digital-template", label: "디지털 템플릿" },
]

// --- 2. [변경] 반응형 스타일 변수 ---

// 공통 스타일:
const baseTagStyle = `
  flex items-center justify-center gap-2.5 rounded-full 
  px-2.5 py-1 text-sm 
  md:px-3.5 md:py-2 md:text-base 
  outline outline-[0.50px] outline-offset-[-0.50px] 
  border-gray-200
  font-['Pretendard'] transition-colors
  whitespace-nowrap // [핵심 수정] 텍스트가 줄바꿈되어 UI가 깨지는 것을 방지
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

export default function CategoryBadgeTabs() {
  const [activeCategoryId, setActiveCategoryId] = React.useState("nail")

  return (
    <nav aria-label="카테고리 필터" className="w-full">
      {/* [핵심 수정]
        <ul> 태그가 스크롤 컨테이너와 flex 컨테이너 역할을 동시에 수행합니다.
      */}
      <ul className="scrollbar-hide flex flex-nowrap items-center gap-[5px] overflow-x-auto md:flex-wrap md:gap-1.5 md:overflow-x-visible">
        {/* [핵심 수정]
          <li>에 flex-shrink-0을 적용하여,
          flex-nowrap 컨테이너 안에서 찌그러지지 않도록 합니다.
        */}
        {categories.map((category) => (
          <li key={category.id} className="flex-shrink-0">
            <button
              type="button"
              onClick={() => setActiveCategoryId(category.id)}
              className={` ${baseTagStyle} ${activeCategoryId === category.id ? activeTagStyle : inactiveTagStyle} `}
              aria-pressed={activeCategoryId === category.id}
            >
              {category.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
