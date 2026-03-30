"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

interface RecentViewsFilterProps {
  excludeSoldout: boolean
  onExcludeSoldoutChange: (checked: boolean) => void
  totalCount: number
}

export function RecentViewsFilter({
  excludeSoldout,
  onExcludeSoldoutChange,
  totalCount,
}: RecentViewsFilterProps) {
  return (
    <div className="mb-4 space-y-3">
      {/* 상품 개수 */}
      <div className="text-sm text-gray-600">
        총 <span className="font-medium text-gray-900">{totalCount}</span>개
      </div>

      {/* 품절상품 제외 체크박스 */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="exclude-soldout"
          checked={excludeSoldout}
          onCheckedChange={(checked) =>
            onExcludeSoldoutChange(checked === true)
          }
        />
        <Label
          htmlFor="exclude-soldout"
          className="cursor-pointer text-sm text-gray-700"
        >
          품절상품 제외
        </Label>
      </div>
    </div>
  )
}
