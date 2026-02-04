"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@components/common/ui/dialog"
import { Checkbox } from "@components/common/ui/checkbox"
import { Button } from "@components/common/ui/button"
import { Input } from "@components/common/ui/input"
import type { CancellationReasonDto } from "@lib/types/dto/membership"

export function MembershipCancelModal({
  open,
  setOpen,
  reasons,
  isSubmitting,
  onConfirm,
}: {
  open: boolean
  setOpen: (open: boolean) => void
  reasons: CancellationReasonDto[]
  isSubmitting?: boolean
  onConfirm: (payload: { reasonCode: string; reasonText?: string }) => void
}) {
  const [selectedReason, setSelectedReason] = useState<string>("")
  const [reasonText, setReasonText] = useState<string>("")

  useEffect(() => {
    if (!open) {
      setSelectedReason("")
      setReasonText("")
    }
  }, [open])

  const showOtherInput = useMemo(() => {
    const selected = reasons.find((reason) => reason.code === selectedReason)
    if (!selected) return false
    return selected.displayText.includes("기타") || selected.code === "OTHER"
  }, [reasons, selectedReason])

  const resolvedReasons =
    reasons.length > 0
      ? [...reasons].sort((a, b) => a.sortOrder - b.sortOrder)
      : [
          {
            code: "OTHER",
            displayText: "기타",
            category: "GENERAL",
            sortOrder: 999,
          },
        ]

  return (
    <>
      {/* Trigger Button */}

      {/* Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-72 rounded-[5px] bg-white pt-6 text-center sm:w-md md:w-136 md:rounded-lg md:pt-8 lg:w-152">
          <DialogHeader>
            <DialogTitle className="text-center text-xs leading-4 font-normal text-black sm:text-sm sm:leading-5 md:text-base md:leading-6 lg:text-lg lg:leading-7">
              이번 달 혜택 사용 내역이 없어
              <br />
              자동으로 결제액 전액 환불됩니다.
              <br />
              언제든 다시 가입하실 수 있어요!
            </DialogTitle>
          </DialogHeader>

          {/* 설명 문구 */}
          <div className="mt-5">
            <p className="text-xs leading-4 font-semibold text-black sm:text-sm sm:leading-5 md:text-base md:leading-6">
              멤버십 취소 이유 (하나 선택)
            </p>
            <p className="text-xs leading-4 font-medium text-gray-500 sm:text-sm sm:leading-5 md:text-base md:leading-6">
              더 나은 서비스를 위해 노력하겠습니다.
            </p>
          </div>

          {/* 체크박스 리스트 */}
          <div className="flex justify-center">
            <ul className="flex flex-col items-start space-y-2">
              {resolvedReasons.map((reason) => (
                <li key={reason.code} className="flex items-center gap-2">
                  <Checkbox
                    id={reason.code}
                    checked={selectedReason === reason.code}
                    onCheckedChange={() =>
                      setSelectedReason((prev) =>
                        prev === reason.code ? "" : reason.code
                      )
                    }
                  />
                  <label
                    htmlFor={reason.code}
                    className="cursor-pointer font-['Pretendard'] text-xs leading-4 text-gray-800 select-none sm:text-sm sm:leading-5 md:text-base md:leading-6"
                  >
                    {reason.displayText}
                  </label>
                </li>
              ))}
            </ul>
          </div>

          {showOtherInput && (
            <div className="mt-3">
              <Input
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
                placeholder="취소 사유를 입력해주세요"
              />
            </div>
          )}

          <DialogFooter className="flex w-full sm:flex-col">
            <div className="flex w-full flex-col gap-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                취소
              </Button>
              <Button
                onClick={() => {
                  if (!selectedReason) return
                  onConfirm({
                    reasonCode: selectedReason,
                    reasonText: showOtherInput ? reasonText : undefined,
                  })
                }}
                disabled={!selectedReason || isSubmitting}
              >
                {isSubmitting ? "처리중..." : "완료"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
