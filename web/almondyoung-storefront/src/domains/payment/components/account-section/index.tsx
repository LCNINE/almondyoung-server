"use client"

import { Button } from "@components/common/ui/button"
import { Card, CardContent } from "@components/common/ui/card"
import { BnplProfileDto } from "@lib/types/dto/wallet"
import { ChevronRight } from "lucide-react"
import EmptyState from "../empty-state"

interface AccountSectionProps {
  defaultBnplProfile: BnplProfileDto | null
  hasError: boolean
}

// 계좌 섹션
export default function AccountSection({
  defaultBnplProfile,
  hasError,
}: AccountSectionProps) {
  if (hasError) {
    return (
      <EmptyState
        message="나중결제 내역을 불러오는데 실패했습니다"
        contentClassName="p-0! py-4! pl-0! md:pl-2!"
        action={
          <Button
            variant="outline"
            className="w-full cursor-pointer px-6 font-medium sm:w-auto"
            onClick={() => window.location.reload()}
          >
            다시 시도
          </Button>
        }
      />
    )
  }

  if (!defaultBnplProfile) {
    return (
      <EmptyState
        message="계좌"
        className="bg-card border-none shadow-xs"
        action={
          <Button
            variant="ghost"
            className="w-full cursor-pointer px-0! font-medium hover:bg-transparent hover:text-inherit sm:w-auto md:px-6"
          >
            <span className="w-full text-left font-bold">
              등록한 계좌가 없어요
            </span>
            <ChevronRight className="size-4" />
          </Button>
        }
      />
    )
  }

  return (
    <Card className="mb-4 border-none shadow-xs">
      <CardContent className="flex items-center justify-between p-7">
        <div>
          <span className="text-foreground font-bold sm:text-lg">계좌</span>
        </div>

        <button
          className="hover:text-primary flex cursor-pointer items-center gap-2 text-base sm:text-lg"
          aria-label="계좌 변경"
        >
          <span className="text-foreground text-sm font-normal sm:text-base">
            {defaultBnplProfile.name ?? "계좌"}
          </span>
          <ChevronRight className="size-4" />
        </button>
      </CardContent>
    </Card>
  )
}
