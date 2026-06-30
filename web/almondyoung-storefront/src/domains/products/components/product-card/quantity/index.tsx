import { Badge } from "@/components/ui/badge"
import DangerCircleIcon from "@/icons/danger-circle-icon"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { HttpTypes } from "@medusajs/types"
import { Calendar } from "lucide-react"
import { useMemo } from "react"
import { PartialSoldOutDialog } from "./partial-sold-out-dialog"
import { calculateStockStatus } from "./stock-status"

interface Props {
  product: HttpTypes.StoreProduct
}

export function Quantity({ product }: Props) {
  const status = useMemo(() => calculateStockStatus(product), [product])

  switch (status.kind) {
    case "soldOut": {
      // 품절 카드: 입고예정 있으면 재입고 날짜 표시, 없으면 품절 배지
      const restockDate = (product.variants ?? [])
        .map((v) => v?.metadata?.inboundDate)
        .filter((d): d is string => typeof d === "string" && !!d)
        .sort()[0]
      return restockDate ? (
        <span className="text-yellow-30 inline-flex items-center gap-1 text-[11px] font-medium">
          <Calendar className="h-3 w-3" aria-hidden="true" />
          {formatDate(restockDate, DATE_FORMATS.KO_DOT)} 재입고
        </span>
      ) : (
        <div>
          {/* TODO: 대체 상품 보기 버튼 및 기능 추가 필요 */}
          <Badge
            variant="secondary"
            className="bg-gray-200 font-bold hover:bg-gray-200"
          >
            품절
          </Badge>
        </div>
      )
    }
    case "partialSoldOut":
      return (
        <PartialSoldOutDialog
          product={product}
          variants={product.variants ?? []}
          total={status.total}
        />
      )
    case "lowStock":
      return (
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-red-500">
          <DangerCircleIcon aria-hidden="true" />
          {status.total}개 남음
        </span>
      )
    case "inStock":
    case "untracked":
    default:
      return null
  }
}
