import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/common/ui/select"
import { Separator } from "@components/common/ui/separator"
import { REVIEW_PERIOD_OPTIONS, REVIEW_TYPE_OPTIONS } from "../utils/constants"

/**
 * 리뷰 필터 컴포넌트
 * 단일 책임: 필터 옵션 표시만 담당
 */
export const ReviewFilters = () => {
  return (
    <div className="flex items-center gap-2 text-[14px] text-[#666666]">
      <Select defaultValue={REVIEW_PERIOD_OPTIONS.SIX_MONTHS}>
        <SelectTrigger className="h-auto w-auto border-none p-0 focus:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={REVIEW_PERIOD_OPTIONS.SIX_MONTHS}>
            6개월
          </SelectItem>
          <SelectItem value={REVIEW_PERIOD_OPTIONS.ONE_YEAR}>1년</SelectItem>
        </SelectContent>
      </Select>
      <Separator orientation="vertical" className="h-4" />
      <Select defaultValue={REVIEW_TYPE_OPTIONS.ALL}>
        <SelectTrigger className="h-auto w-auto border-none p-0 focus:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={REVIEW_TYPE_OPTIONS.ALL}>전체</SelectItem>
          <SelectItem value={REVIEW_TYPE_OPTIONS.PHOTO_VIDEO}>
            포토/동영상
          </SelectItem>
          <SelectItem value={REVIEW_TYPE_OPTIONS.TEXT_ONLY}>일반</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
