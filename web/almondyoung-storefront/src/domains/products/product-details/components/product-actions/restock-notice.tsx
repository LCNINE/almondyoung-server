"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { HttpTypes } from "@medusajs/types"
import { Info } from "lucide-react"
import { useTranslations } from "next-intl"

interface Props {
  variants: (HttpTypes.StoreProductVariant | undefined)[]
}

// 품절 옵션들 중 가장 이른 입고예정일을 고른다.
// 데이터(variant.metadata.inboundDate)가 없으면 null → 아무것도 렌더하지 않음.
// metadata 는 core inbound_plans → Medusa variant.metadata 동기화로 채워질 예정.
export function pickEarliestRestock(variants: Props["variants"]) {
  const candidates = variants
    .map((v) => {
      const date = v?.metadata?.inboundDate
      if (typeof date !== "string" || !date) return null
      return { date, approximate: Boolean(v?.metadata?.inboundApproximate) }
    })
    .filter((x): x is { date: string; approximate: boolean } => x !== null)

  if (candidates.length === 0) return null
  // ISO/`YYYY-MM-DD` 문자열은 사전순 = 시간순
  candidates.sort((a, b) => a.date.localeCompare(b.date))
  return candidates[0]
}

export function RestockNotice({ variants }: Props) {
  const t = useTranslations("productDetail.options")
  const restock = pickEarliestRestock(variants)
  if (!restock) return null

  return (
    <div className="flex items-center justify-center gap-1 text-[13px] text-gray-600">
      <span>
        {t("restockExpected", {
          date: formatDate(restock.date, DATE_FORMATS.KO_DOT),
        })}
      </span>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("restockInfoLabel")}
              className="inline-flex text-gray-400 hover:text-gray-600 focus:outline-none"
              onClick={(e) => e.preventDefault()}
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[220px] text-center text-xs">
            {t("restockApproximate")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
