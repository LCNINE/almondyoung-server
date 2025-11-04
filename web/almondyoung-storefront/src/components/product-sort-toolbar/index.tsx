import React from "react"
// [참고] ChevronDown은 이제 데스크탑 '60개씩 보기'에만 사용됩니다.
import { ChevronDown } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/common/ui/select" // (커스터마이징된 경로)

// 정렬 옵션 데이터
const sortOptions = [
  // [참고] 시안의 '추천 순'은 데이터의 '아몬드영 랭킹 순'으로 간주합니다.
  { id: "ranking", label: "아몬드영 랭킹 순" },
  { id: "price-asc", label: "낮은가격순" },
  { id: "price-desc", label: "높은가격순" },
  { id: "sales", label: "판매량순" },
  { id: "newest", label: "최신순" },
]

export default function ProductSortToolbar() {
  const [activeSort, setActiveSort] = React.useState("ranking")

  return (
    <div className="mb-[20px] flex items-center self-stretch py-2.5 md:justify-between md:bg-gray-100 md:px-3.5">
      {/* --- 1. 정렬 옵션 (Left) --- */}

      {/* [데스크탑 뷰] */}
      <div className="hidden items-center divide-x divide-gray-300 md:flex">
        {sortOptions.map((option, index) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setActiveSort(option.id)}
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

      {/* [모바일 뷰] */}
      <div className="relative md:hidden">
        {/* (components/ui/select.tsx에서 아이콘이 제거되었다고 가정) */}
        <Select value={activeSort} onValueChange={setActiveSort}>
          <SelectTrigger className="// [수정] w-16(고정값) -> w-auto(가변) // [수정] shadcn 기본값(j-between) 제거 // [적용] 시안의 텍스트와 아이콘(제거됨) 간격 // [수정] 시안에 맞게 둥글기 조절 (예: 'rounded-none') // [적용] 시안 스타일 // [적용] 시안의 // [적용] 시안 폰트 left-[5.06px] flex h-6 w-auto items-center justify-start gap-1 rounded-sm border-[0.50px] border-zinc-300 bg-white px-2 font-['Pretendard'] text-xs font-medium text-black focus:ring-0">
            {/* 이제 아이콘이 없으므로 SelectValue가 
              왼쪽 정렬(justify-start)되어 시안과 일치합니다. 
            */}
            <SelectValue placeholder="정렬 기준" />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
