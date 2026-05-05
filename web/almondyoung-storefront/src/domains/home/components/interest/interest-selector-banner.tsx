"use client"

import { Button } from "@/components/ui/button"
import { CustomButton } from "@/components/shared/custom-buttons"
import {
  dismissInterestBanner7Days,
  updateInterestCategories,
} from "@/domains/home/interest-categories-actions"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { InterestKeyChips } from "./interest-key-chips"

/*───────────────────────────
 * 관심 카테고리 미선택 상태에서 노출되는 홈 상단 배너
 * - 8개 칩에서 최대 3개 선택 → "저장" 또는 "1주일간 보지 않음"
 *──────────────────────────*/
export function InterestSelectorBanner() {
  const [selected, setSelected] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    if (selected.length === 0) {
      toast.message("1개 이상 선택해주세요")
      return
    }

    startTransition(async () => {
      try {
        await updateInterestCategories(selected)
        toast.success("관심 카테고리가 저장됐어요")
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error("저장에 실패했어요. 다시 시도해주세요.")
      }
    })
  }

  const handleDismiss = () => {
    startTransition(async () => {
      try {
        await dismissInterestBanner7Days()
      } catch {
        toast.error("처리에 실패했어요")
      }
    })
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 md:p-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight text-zinc-900 md:text-lg">
          어떤 시술 분야에 관심 있으세요?
        </h3>
        <p className="text-xs text-zinc-500 md:text-sm">
          최대 3개까지 선택할 수 있어요. 선택하신 카테고리의 베스트 상품을 먼저
          보여드릴게요.
        </p>
      </div>

      <InterestKeyChips
        selectedKeys={selected}
        onChange={setSelected}
        disabled={isPending}
        className="mt-4"
      />

      <div className="mt-5 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          disabled={isPending}
          className="text-xs text-zinc-500 hover:text-zinc-700"
        >
          1주일간 보지 않기
        </Button>
        <CustomButton
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={isPending || selected.length === 0}
          className="rounded-full"
        >
          {isPending ? "저장 중..." : "저장"}
        </CustomButton>
      </div>
    </section>
  )
}
