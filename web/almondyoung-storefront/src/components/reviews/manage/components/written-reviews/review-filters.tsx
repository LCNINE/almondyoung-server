"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"
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
            6개월
          </SelectItem>
          <SelectItem value={REVIEW_PERIOD_OPTIONS.ONE_YEAR}>1년</SelectItem>
          <SelectItem value={REVIEW_PERIOD_OPTIONS.ALL}>전체</SelectItem>
        </SelectContent>
      </Select>
      <Separator orientation="vertical" className="h-4" />
      <Select value={type} onValueChange={handleTypeChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={REVIEW_TYPE_OPTIONS.ALL}>전체</SelectItem>
          <SelectItem value={REVIEW_TYPE_OPTIONS.PHOTO}>
            포토/동영상
          </SelectItem>
          <SelectItem value={REVIEW_TYPE_OPTIONS.TEXT}>일반</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
