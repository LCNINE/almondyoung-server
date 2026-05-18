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
import { useTranslations } from "next-intl"
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
  const t = useTranslations("mypage.account.interest")
  const [selected, setSelected] = useState<string[]>(initialKeys)
  const [isPending, startTransition] = useTransition()

  const isDirty =
    selected.length !== initialKeys.length ||
    selected.some((k, i) => k !== initialKeys[i])

  const handleSave = () => {
    startTransition(async () => {
      try {
        await updateInterestCategories(selected)
        toast.success(t("saved"))
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("saveFailed"))
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("title")}</CardTitle>
        <CardDescription>
          {t("description", { max: MAX_INTEREST_CATEGORIES })}
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
            {isPending ? t("saving") : t("save")}
          </CustomButton>
        </div>
      </CardContent>
    </Card>
  )
}
