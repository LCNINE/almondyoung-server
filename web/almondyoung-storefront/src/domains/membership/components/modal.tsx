"use client"

import Image from "next/image"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@components/common/ui/dialog"
import { Checkbox } from "@components/common/ui/checkbox"

const cancelReasons = [
  "혜택이 기대보다 적어요",
  "가격이 부담돼요",
  "서비스 이용이 불편했어요",
  "일시적으로 이용이 필요 없어요",
  "다른 멤버십을 이용 중이에요",
  "기타",
]

export function MembershipCancelModal({
  open,
  setOpen,
}: {
  open: boolean
  setOpen: (open: boolean) => void
}) {
  return (
    <>
      {/* Trigger Button */}

      {/* Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-72 rounded-[5px] bg-white pt-6 text-center sm:w-[28rem] md:w-[34rem] md:rounded-lg md:pt-8 lg:w-[38rem]">
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
              멤버십 취소 이유 (다중 선택 가능)
            </p>
            <p className="text-xs leading-4 font-medium text-gray-500 sm:text-sm sm:leading-5 md:text-base md:leading-6">
              더 나은 서비스를 위해 노력하겠습니다.
            </p>
          </div>

          {/* 체크박스 리스트 */}
          <div className="flex justify-center">
            <ul className="flex flex-col items-start space-y-2">
              {cancelReasons.map((reason) => (
                <li key={reason} className="flex items-center gap-2">
                  <Checkbox
                    id={reason}
                    checked={cancelReasons.includes(reason)}
                    onCheckedChange={() => {}}
                  />
                  <label
                    htmlFor={reason}
                    className="cursor-pointer font-['Pretendard'] text-xs leading-4 text-gray-800 select-none sm:text-sm sm:leading-5 md:text-base md:leading-6"
                  >
                    {reason}
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <DialogFooter className="flex w-full sm:flex-col">
            <div className="border-Color flex flex-col items-center justify-center gap-2.5 self-stretch border-t-[0.50px] py-2.5">
              <div className="justify-center text-center font-['Pretendard'] text-base leading-5 font-normal text-black sm:text-[17px] sm:leading-6 md:text-lg md:leading-7">
                취소
              </div>
            </div>
            <div className="border-Color flex flex-col items-center justify-center gap-2.5 self-stretch border-t-[0.50px] py-2.5">
              <div className="justify-center text-center font-['Pretendard'] text-base leading-5 font-normal text-red-500 sm:text-[17px] sm:leading-6 md:text-lg md:leading-7">
                완료
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
