"use client"

import { Button } from "@/components/ui/button"
import { MapPin } from "lucide-react"

interface EmptyAddressStateProps {
  onSelectSaved: () => void
  onAddNew: () => void
}

/**
 * 배송지가 없을 때 표시되는 상태
 */
export function EmptyAddressState({
  onSelectSaved,
  onAddNew,
}: EmptyAddressStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 lg:py-12">
      <div className="bg-gray-10 mb-4 flex h-12 w-12 items-center justify-center rounded-full lg:h-16 lg:w-16">
        <MapPin className="text-gray-40 h-6 w-6 lg:h-8 lg:w-8" />
      </div>
      <h3 className="text-gray-90 mb-2 text-base font-semibold lg:text-lg">
        배송지 정보가 없습니다
      </h3>
      <p className="text-gray-60 mb-4 text-center text-sm lg:text-base">
        배송지를 등록해주세요.
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onSelectSaved}>
          저장된 배송지
        </Button>
        <Button type="button" onClick={onAddNew}>
          새 배송지 추가
        </Button>
      </div>
    </div>
  )
}
