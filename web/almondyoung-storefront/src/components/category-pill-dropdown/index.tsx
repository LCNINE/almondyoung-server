"use client"

import { Triangle } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/common/ui/dropdown-menu"
import React from "react"
import { cn } from "@lib/utils" // (cn 유틸리티를 사용해 클래스를 병합합니다)

// 드롭다운 리스트에 표시될 목업(Mock) 데이터
const categoryOptions = [
  { id: "eyelash", label: "속눈썹" },
  { id: "nail", label: "네일" },
  { id: "hair", label: "헤어" },
  { id: "waxing", label: "왁싱" },
]

// [신규] 스타일 변수화 (DRY 원칙)
const triggerFont = "font-['Pretendard'] text-xs"
const triggerColor = "text-[#ffa500]"
const triggerBorder = "border border-[#ffa500]"
const triggerBg = "bg-white"
const hoverBg = "hover:bg-orange-50"

export default function CategoryPillDropdown() {
  const [selectedLabel, setSelectedLabel] = React.useState(
    categoryOptions[0].label
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center justify-center gap-0.5",
            "rounded-full px-3.5 py-0.5",
            "transition-colors",
            triggerFont,
            triggerColor,
            triggerBorder,
            triggerBg,
            hoverBg
          )}
        >
          <span>{selectedLabel}</span>
          <Triangle
            className="h-2.5 w-2.5 rotate-180"
            fill="#FFA500"
            strokeWidth={0}
          />
        </button>
      </DropdownMenuTrigger>

      {/* [수정] DropdownMenuContent에 스타일을 적용합니다. */}
      <DropdownMenuContent
        className={cn(
          "min-w-[var(--radix-dropdown-menu-trigger-width)]", // 트리거와 너비를 맞춥니다
          triggerBorder, // 트리거와 동일한 테두리
          triggerBg // 트리거와 동일한 배경
        )}
      >
        {categoryOptions.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() => setSelectedLabel(option.label)}
            // [수정] DropdownMenuItem에 스타일을 적용합니다.
            className={cn(
              "focus:bg-orange-50", // shadcn의 기본 focus 스타일 오버라이드
              triggerFont, // 트리거와 동일한 폰트/크기
              "text-black" // (활성/비활성 텍스트 색상)
            )}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
