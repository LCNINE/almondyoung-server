"use client"

import { Button } from "@components/common/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@components/common/ui/card"
import type { BnplProfileDto } from "@lib/types/dto/wallet"
import type { UserDetail } from "@lib/types/ui/user"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import EmptyState from "../empty-state"

// 나중결제 내역 섹션
export default function BnplSection({
  onBnplRegisterClick,
  bnplProfiles,
}: {
  onBnplRegisterClick: () => void
  bnplProfiles: BnplProfileDto[]
}) {
  const hasBnplProfile = bnplProfiles.length > 0

  if (!hasBnplProfile) {
    return (
      <EmptyState
        message="아직 등록한 계좌가 없습니다"
        contentClassName="p-0! py-4! pl-0! md:pl-2!"
        action={
          <Button
            variant="default"
            className="w-full cursor-pointer px-6 font-medium sm:w-auto"
            onClick={onBnplRegisterClick}
          >
            + 결제수단 등록
          </Button>
        }
      />
    )
  }

  return (
    <>
      <Card className="border-none shadow-xs">
        <CardHeader className="">
          <CardTitle className="flex items-center gap-4 text-lg font-bold">
            <Button
              size="icon"
              variant="ghost"
              className="hover:text-primary cursor-pointer p-0 hover:bg-transparent"
            >
              <ChevronLeftIcon className="size-6" />
            </Button>
            나중결제 내역
            <Button
              size="icon"
              variant="ghost"
              className="hover:text-primary cursor-pointer p-0 hover:bg-transparent"
            >
              <ChevronRightIcon className="size-6" />
            </Button>
          </CardTitle>
        </CardHeader>

        <CardContent>
          <CardDescription className="sr-only">나중결제 내역</CardDescription>

          <div className="flex items-baseline gap-1">
            {/* 금액 */}
            <div className="flex-1">
              <span className="text-3xl font-bold text-gray-900">156,000</span>
              <span className="text-base text-gray-500"> 원 </span>
            </div>

            {/* 결제일 정보 */}
            <div className="mt-2 flex flex-2 items-center gap-2 text-sm text-gray-600">
              <span>6월 7일 결제</span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                D-3
              </span>
              <span className="text-gray-300">/</span>
              <span>우리 은행</span>
            </div>
          </div>

          {/* 액션 버튼들 */}
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-yellow-40 border-yellow-40 hover:bg-yellow-10 hover:text-yellow-30 cursor-pointer px-4 py-5 text-sm font-normal"
            >
              내역 보기
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer px-4 py-5 text-sm font-normal text-gray-700 hover:bg-transparent hover:text-gray-700"
              onClick={onBnplRegisterClick}
            >
              출금 계좌 변경
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
