"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { InterestKeyChips } from "@/domains/home/components/interest/interest-key-chips"
import { updateInterestCategories } from "@/domains/home/interest-categories-actions"
import { MAX_INTEREST_CATEGORIES } from "@/lib/constants/categories"
import { useState, useTransition } from "react"
import { toast } from "sonner"

interface InterestCategoriesSectionProps {
  initialKeys: string[]
}

/*───────────────────────────
 * 마이페이지 프로필 편집의 "관심 카테고리" 섹션
 * - 동일 server action(updateInterestCategories) 사용 → 서버 PATCH + 쿠키 동기화
 *──────────────────────────*/
export function InterestCategoriesSection({
  initialKeys,
}: InterestCategoriesSectionProps) {
  const [selected, setSelected] = useState<string[]>(initialKeys)
  const [isPending, startTransition] = useTransition()

  const isDirty =
    selected.length !== initialKeys.length ||
    selected.some((k, i) => k !== initialKeys[i])

  const handleSave = () => {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">관심 카테고리</CardTitle>
        <CardDescription>
          최대 {MAX_INTEREST_CATEGORIES}개까지 선택할 수 있어요. 선택한
          카테고리의 베스트 상품을 홈에서 먼저 보여드리고, 헤더 메뉴 맨 앞에
          정렬됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <InterestKeyChips
          selectedKeys={selected}
          onChange={setSelected}
          disabled={isPending}
        />
        <div className="flex justify-end">
          <CustomButton
            type="button"
            onClick={handleSave}
            disabled={isPending || !isDirty}
            className="px-8"
          >
            {isPending ? "저장 중..." : "저장"}
          </CustomButton>
        </div>
      </CardContent>
    </Card>
  )
}
