import React from "react"
import { Checkbox } from "@components/common/ui/checkbox"
import { CustomButton } from "@components/common/custom-buttons/custom-button"

interface CartControlsProps {
  isAllChecked: boolean
  onCheckAll: (checked: boolean) => void
  onDeleteSelected: () => void
  variant?: "mobile" | "desktop"
}

export function CartControls({
  isAllChecked,
  onCheckAll,
  onDeleteSelected,
  variant = "mobile",
}: CartControlsProps) {
  if (variant === "mobile") {
    return (
      <header className="selection-controls">
        <div className="controls-container flex items-center justify-between">
          <div className="select-all">
            <label className="select-label flex items-center gap-4 text-sm">
              <Checkbox checked={isAllChecked} onCheckedChange={onCheckAll} />
              <span className="text-base font-semibold select-text">
                전체 선택
              </span>
            </label>
          </div>
          <div className="bulk-actions">
            <button
              className="delete-button text-sm text-gray-500"
              onClick={onDeleteSelected}
            >
              선택삭제
            </button>
          </div>
        </div>
      </header>
    )
  }

  return (
    <div className="border-b border-gray-200 px-8 py-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-3">
          <Checkbox checked={isAllChecked} onCheckedChange={onCheckAll} />
          <span className="text-base font-semibold">전체 선택</span>
        </label>
        <CustomButton
          onClick={onDeleteSelected}
          variant="secondary"
          size="sm"
        >
          선택삭제
        </CustomButton>
      </div>
    </div>
  )
}

