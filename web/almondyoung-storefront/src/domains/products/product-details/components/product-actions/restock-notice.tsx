"use client"

import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { HttpTypes } from "@medusajs/types"
import { Calendar } from "lucide-react"
import { useTranslations } from "next-intl"

interface Props {
  variants: (HttpTypes.StoreProductVariant | undefined)[]
}

// 품절 옵션들 중 가장 이른 입고예정일을 고른다.
// 데이터(variant.metadata.inboundDate)가 없으면 null → 아무것도 렌더하지 않음.
// metadata 는 core inbound_plans → Medusa variant.metadata 동기화로 채워짐 (sync-restock-to-medusa.ts).
//
// 지난 날짜는 후보에서 뺀다. 동기화가 stale 값을 남기면(입고완료/취소 후 미삭제)
// "재입고 : 2026년 7월 14일 예정" 처럼 이미 지난 날을 안내하게 된다. 그 경우엔
// 안내를 아예 안 띄우고 일반 품절로 보여주는 편이 맞다.
export function pickEarliestRestock(variants: Props["variants"]) {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const candidates = variants
    .map((v) => {
      const date = v?.metadata?.inboundDate
      if (typeof date !== "string" || !date) return null
      if (date.slice(0, 10) < today) return null // 지난 입고예정일 = stale
      return { date, approximate: Boolean(v?.metadata?.inboundApproximate) }
    })
    .filter((x): x is { date: string; approximate: boolean } => x !== null)

  if (candidates.length === 0) return null
  // ISO/`YYYY-MM-DD` 문자열은 사전순 = 시간순
  candidates.sort((a, b) => a.date.localeCompare(b.date))
  return candidates[0]
}

/**
 * 상세페이지 품절 시 "일시 품절 + 재입고 예정" 안내.
 */
export function RestockNotice({ variants }: Props) {
  const t = useTranslations("productDetail.options")
  const restock = pickEarliestRestock(variants)
  if (!restock) return null

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <span className="text-[15px] font-bold text-gray-800">
        {t("soldOutTemporary")}
      </span>
      <div className="bg-yellow-30 flex h-12 w-full items-center justify-center gap-2 rounded-lg px-4">
        <Calendar className="h-5 w-5 shrink-0 text-white" aria-hidden="true" />
        <span className="text-[15px] font-bold text-white">
          {t("restockExpected", {
            date: formatDate(restock.date, DATE_FORMATS.KO_LONG),
          })}
        </span>
      </div>
      {restock.approximate && (
        <span className="text-[11px] leading-tight text-gray-400">
          {t("restockApproximate")}
        </span>
      )}
    </div>
  )
}
