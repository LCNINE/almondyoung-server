"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/common/ui/select"
import { Separator } from "@components/common/ui/separator"
import {
  REVIEW_PERIOD_OPTIONS,
  REVIEW_TYPE_OPTIONS,
  type ReviewPeriod,
  type ReviewType,
} from "../../utils/constants"

interface ReviewFiltersProps {
  period: ReviewPeriod
  type: ReviewType
}

export const ReviewFilters = ({ period, type }: ReviewFiltersProps) => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations("mypage.reviews")

  const updateSearchParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set(key, value)
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  const handlePeriodChange = (value: ReviewPeriod) => {
    updateSearchParams("period", value)
  }

  const handleTypeChange = (value: ReviewType) => {
    updateSearchParams("type", value)
  }

  return (
    <div className="flex items-center gap-2 text-[14px] text-[#666666]">
      <Select value={period} onValueChange={handlePeriodChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={REVIEW_PERIOD_OPTIONS.SIX_MONTHS}>
            {t("filterPeriodSix")}
          </SelectItem>
          <SelectItem value={REVIEW_PERIOD_OPTIONS.ONE_YEAR}>{t("filterPeriodOneYear")}</SelectItem>
          <SelectItem value={REVIEW_PERIOD_OPTIONS.ALL}>{t("filterPeriodAll")}</SelectItem>
        </SelectContent>
      </Select>
      <Separator orientation="vertical" className="h-4" />
      <Select value={type} onValueChange={handleTypeChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={REVIEW_TYPE_OPTIONS.ALL}>{t("filterTypeAll")}</SelectItem>
          <SelectItem value={REVIEW_TYPE_OPTIONS.PHOTO}>
            {t("filterTypePhoto")}
          </SelectItem>
          <SelectItem value={REVIEW_TYPE_OPTIONS.TEXT}>{t("filterTypeText")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
