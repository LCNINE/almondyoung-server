"use client"

import { Checkbox } from "@components/common/ui/checkbox"
import { Label } from "@components/common/ui/label"
import { Button } from "@components/common/ui/button"
import { useState } from "react"

interface AllAgreementsCheckboxProps {
  checked?: boolean
  onChange: (checked: boolean) => void
}

export function AllAgreementsCheckbox({
  checked,
  onChange,
}: AllAgreementsCheckboxProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <div className="flex h-5 items-center gap-1">
        <Checkbox
          id="check-all"
          className="h-3.5 w-3.5"
          checked={checked}
          onCheckedChange={(checked) => onChange(checked as boolean)}
        />
        <Label
          htmlFor="check-all"
          className="text-base leading-5 font-semibold"
        >
          모두 확인하였으며 동의합니다.{" "}
          <Button variant="link" size="sm" onClick={() => setIsOpen(!isOpen)}>
            전문보기
          </Button>
        </Label>
      </div>
      {isOpen && (
        <div className="mt-2">
          <p className="text-xs leading-[17px] tracking-[-0.01em] md:text-sm">
            전체 동의에는 필수 및 선택 정보에 대한 동의가 포함되어 있으며,
            개별적으로 동의를 선택 하실 수 있습니다. 선택 항목에 대한 동의를
            거부하시는 경우에도 서비스 이용이 가능합니다.
          </p>
        </div>
      )}
    </>
  )
}
