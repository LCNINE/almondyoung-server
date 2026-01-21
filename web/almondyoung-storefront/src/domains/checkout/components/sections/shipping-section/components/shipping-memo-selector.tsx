"use client"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { SHIPPING_MEMO_OPTIONS } from "../constants"

interface ShippingMemoSelectorProps {
  selectedMemoType: string
  customMemo: string
  onMemoTypeChange: (value: string) => void
  onCustomMemoChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * 배송 메모 선택 컴포넌트 (Controlled)
 *
 * - 저장은 하지 않고 상태 변경만 처리
 * - 실제 저장은 결제 시점에 상위에서 처리
 */
export function ShippingMemoSelector({
  selectedMemoType,
  customMemo,
  onMemoTypeChange,
  onCustomMemoChange,
}: ShippingMemoSelectorProps) {
  const isOtherSelected = selectedMemoType === "other"

  return (
    <div className="mt-4 space-y-3">
      <Select value={selectedMemoType} onValueChange={onMemoTypeChange}>
        <SelectTrigger
          className={cn(
            "h-auto w-full rounded border border-gray-300 bg-white px-3 py-2.5 text-[13px] text-gray-700 md:rounded-[5px] md:px-4 md:py-3.5 md:text-sm",
            !selectedMemoType && "text-gray-400"
          )}
          aria-label="배송메모 선택"
        >
          <SelectValue placeholder="배송메모를 선택해주세요" />
        </SelectTrigger>
        <SelectContent>
          {SHIPPING_MEMO_OPTIONS.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="cursor-pointer py-2.5 text-[13px] md:text-sm"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <CustomMemoInput
        isVisible={isOtherSelected}
        value={customMemo}
        onChange={onCustomMemoChange}
      />
    </div>
  )
}

/**
 * 직접 입력 메모 필드
 */
function CustomMemoInput({
  isVisible,
  value,
  onChange,
}: {
  isVisible: boolean
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div
      className={cn(
        "grid transition-all duration-200 ease-in-out",
        isVisible ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="overflow-hidden">
        <div className="relative">
          <Input
            type="text"
            value={value}
            onChange={onChange}
            placeholder="배송 시 요청사항을 입력해주세요"
            maxLength={50}
            className="h-auto w-full rounded border border-gray-300 px-3 py-2.5 pr-14 text-[13px] text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white md:rounded-[5px] md:px-4 md:py-3.5 md:text-sm"
            aria-label="배송메모 직접 입력"
          />
          <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-gray-400 md:text-xs">
            {value.length}/50
          </span>
        </div>
      </div>
    </div>
  )
}
