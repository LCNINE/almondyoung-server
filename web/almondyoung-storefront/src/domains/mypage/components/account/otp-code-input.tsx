"use client"

import { cn } from "@/lib/utils"
import { OTPInput, OTPInputContext } from "input-otp"
import * as React from "react"

// ui/InputOTPSlot 은 브랜드 노란색 테두리/캐럿이 박혀 있어, 여기선 자체 슬롯을 렌더해
// 미니멀(흰 배경/무채색 + 회색 캐럿)로 통일한다. ui/ 소스는 건드리지 않는다.
function Slot({ index }: { index: number }) {
  const ctx = React.useContext(OTPInputContext)
  const slot = ctx?.slots[index]
  const char = slot?.char
  const isActive = slot?.isActive
  const hasFakeCaret = slot?.hasFakeCaret

  return (
    <div
      className={cn(
        "relative flex size-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-lg font-semibold text-gray-900 outline-none transition-all sm:size-14 sm:text-xl",
        isActive && "border-gray-900 ring-2 ring-gray-900/15",
        char && !isActive && "border-gray-300"
      )}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-px animate-pulse rounded-full bg-gray-900 sm:h-7" />
        </div>
      )}
    </div>
  )
}

// 6자리 코드 입력 — 미니멀 + 모바일 반응형. 휴대폰 변경/본인확인 게이트에서 공통 사용.
export function OtpCodeInput({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <OTPInput
      maxLength={6}
      value={value}
      onChange={onChange}
      containerClassName="w-full justify-center has-disabled:opacity-50"
      className="disabled:cursor-not-allowed"
    >
      <div className="flex items-center gap-1.5 sm:gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Slot key={i} index={i} />
        ))}
      </div>
    </OTPInput>
  )
}
