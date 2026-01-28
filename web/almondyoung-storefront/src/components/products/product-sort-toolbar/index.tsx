// [참고] ChevronDown은 이제 데스크탑 '60개씩 보기'에만 사용됩니다.
import { ChevronDown } from "lucide-react"

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
    <div className="mb-[20px] flex items-center self-stretch py-2.5 md:justify-between md:bg-gray-100 md:px-3.5">
      {/* --- 1. 정렬 옵션 (Left) --- */}

      {/* [데스크탑 뷰] */}
      <div className="hidden items-center divide-x divide-gray-300 md:flex">
        {sortOptions.map((option, index) => (
          <button
            key={option.id}
            type="button"
            onClick={() => handleSortChange(option.id)}
            className={`font-['Pretendard'] text-base ${index > 0 ? "pl-4" : ""} ${index < sortOptions.length - 1 ? "pr-4" : ""} ${
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

      {/* --- 2. 보기 옵션 (Right - 데스크탑 전용) --- */}
      <button
        type="button"
        className="hidden flex-shrink-0 items-center gap-1.5 md:flex"
        aria-haspopup="true"
        aria-expanded="false"
      >
        <span className="font-['Pretendard'] text-base font-normal text-gray-700">
          60개씩 보기
        </span>
        <ChevronDown
          className="h-5 w-5 flex-shrink-0 text-gray-500"
          strokeWidth={2.5}
        />
      </button>
    </div>
  )
}
