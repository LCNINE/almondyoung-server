import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { HttpTypes } from "@medusajs/types"
import { useState } from "react"
import {
  LOW_STOCK_THRESHOLD,
  getVariantLabel,
  getVariantStock,
  isVariantSoldOut,
} from "./stock-status"

// 호출처(VariantStockList)에서 stock !== null 인 variant만 넘김
const VariantStockBadge = ({
  variant,
  stock,
}: {
  variant: HttpTypes.StoreProductVariant
  stock: number
}) => {
  if (isVariantSoldOut(variant)) {
    return <span className="text-[13px] font-medium text-red-500">품절</span>
  }
  if (stock <= LOW_STOCK_THRESHOLD) {
    return (
      <span className="text-[13px] font-medium text-red-500">{stock}개</span>
    )
  }
  return <span className="text-[13px] text-gray-700">{stock}개</span>
}

const VariantStockList = ({
  variants,
}: {
  variants: HttpTypes.StoreProductVariant[]
}) => {
  // 재고관리 안 하는 variant는 popup의 목적과 무관하므로 제외
  const visible = variants
    .map((v) => ({ variant: v, stock: getVariantStock(v) }))
    .filter(
      (x): x is { variant: HttpTypes.StoreProductVariant; stock: number } =>
        x.stock !== null
    )

  if (visible.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-500">
        옵션 정보가 없습니다.
      </p>
    )
  }

  return (
    <ul className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto">
      {visible.map(({ variant, stock }) => (
        <li
          key={variant.id}
          className={cn(
            "flex items-center justify-between gap-4 py-3",
            isVariantSoldOut(variant) && "opacity-60"
          )}
        >
          <span className="text-[13px] text-gray-800">
            {getVariantLabel(variant)}
          </span>
          <VariantStockBadge variant={variant} stock={stock} />
        </li>
      ))}
    </ul>
  )
}

interface Props {
  product: HttpTypes.StoreProduct
  variants: HttpTypes.StoreProductVariant[]
  total: number
}

export function PartialSoldOutDialog({ product, variants, total }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            // 부모 <a>의 navigation 차단 + Radix 기본 토글 대신 직접 open 제어
            e.preventDefault()
            e.stopPropagation()
            setOpen(true)
          }}
          className="inline-flex items-center gap-2 focus:outline-none"
          aria-label="옵션별 재고 현황 보기"
        >
          <Badge
            variant="outline"
            className="cursor-pointer border-gray-300 font-bold text-gray-600 hover:bg-gray-100"
          >
            일부 품절
          </Badge>

          {total > 0 && total <= LOW_STOCK_THRESHOLD && (
            <span className="text-[12px] text-red-500">{total}개 남음</span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent
        onClick={(e) => e.stopPropagation()}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="text-base">옵션별 재고 현황</DialogTitle>
          <DialogDescription className="line-clamp-1 text-[13px]">
            {product.title}
          </DialogDescription>
        </DialogHeader>
        <VariantStockList variants={variants} />
      </DialogContent>
    </Dialog>
  )
}
