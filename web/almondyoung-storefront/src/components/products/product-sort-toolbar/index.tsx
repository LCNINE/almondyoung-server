// 정렬 옵션 데이터
const sortOptions = [
  // [참고] 시안의 '추천 순'은 데이터의 '아몬드영 랭킹 순'으로 간주합니다.
  { id: "ranking", label: "아몬드영 랭킹 순" },
  { id: "price-asc", label: "낮은가격순" },
  { id: "price-desc", label: "높은가격순" },
  { id: "sales", label: "판매량순" },
  { id: "newest", label: "최신순" },
]

interface ProductSortToolbarProps {
  activeSort?: string
  onSortChange?: (sort: string) => void
}

export default function ProductSortToolbar({
  activeSort: controlledActiveSort,
  onSortChange,
}: ProductSortToolbarProps = {}) {
  // 제어/비제어 모드 지원
  const activeSort = controlledActiveSort ?? "ranking"

  const handleSortChange = (sort: string) => {
    onSortChange?.(sort)
  }

  return (
    <div className="mb-[20px] self-stretch py-2.5 md:bg-gray-100 md:px-3.5">
      {/* --- 1. 정렬 옵션 (Left) --- */}

      {/* [데스크탑 뷰] */}
      <div className="hidden flex-wrap items-center gap-x-4 gap-y-2 md:flex lg:flex-nowrap lg:divide-x lg:divide-gray-300">
        {sortOptions.map((option, index) => (
          <button
            key={option.id}
            type="button"
            onClick={() => handleSortChange(option.id)}
            className={`shrink-0 whitespace-nowrap font-['Pretendard'] text-base ${index > 0 ? "lg:pl-4" : ""} ${index < sortOptions.length - 1 ? "lg:pr-4" : ""} ${
              activeSort === option.id
                ? "font-bold text-stone-900" // 활성
                : "font-normal text-gray-500 hover:text-stone-900" // 비활성
            } `}
            aria-pressed={activeSort === option.id}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
