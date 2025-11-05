"use client"

import { Checkbox } from "@components/common/ui/checkbox"
import { Label } from "@components/common/ui/label"

interface AllAgreementsCheckboxProps {
  checked?: boolean
  onChange: (checked: boolean) => void
}

export function AllAgreementsCheckbox({
  checked,
  onChange,
}: AllAgreementsCheckboxProps) {
  return (
    <>
      <div className="flex h-5 items-center gap-1">
        <Checkbox
          id="check-all"
          className="h-3.5 w-3.5"
          checked={checked}
          onCheckedChange={(checked) => onChange(checked as boolean)}
        />
        <Label htmlFor="check-all" className="text-sm leading-5 font-semibold">
          모두 확인하였으며 동의합니다.
        </Label>
      </div>

      <p className="mt-1.5 h-[45px] w-full pl-5 text-xs leading-[15px] tracking-[-0.01em]">
        {/* <p className="mt-1.5 ml-6 h-[45px] w-[318px] text-xs leading-[15px] tracking-[-0.01em]"> */}
        전체 동의에는 필수 및 선택 정보에 대한 동의가 포함되어 있으며,
        개별적으로 동의를 선택 하실 수 있습니다. 선택 항목에 대한 동의를
        거부하시는 경우에도 서비스 이용이 가능합니다.
      </p>
    </>
  )
}
