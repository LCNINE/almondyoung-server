"use client"

import { Button } from "@components/common/ui/button"
import { BnplProfileDto } from "@lib/types/dto/wallet"
import { ChevronRight } from "lucide-react"
import EmptyState from "../empty-state"
import { useBnplModalStore } from "../store/bnpl-modal-store"

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

  return <section className="bg-gray-10 p-4"></section>
}
