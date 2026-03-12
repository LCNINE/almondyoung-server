"use client"

import { useState } from "react"
import Image from "next/image"
import { Loader2, Trash2 } from "lucide-react"
import { HttpTypes } from "@medusajs/types"
import { toast } from "sonner"

import { TableCell, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { deleteLineItem, updateLineItem } from "@/lib/api/medusa/cart"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { formatPrice } from "@/lib/utils/price-utils"

type ItemProps = {
  item: HttpTypes.StoreCartLineItem
  type?: "full" | "preview"
  currencyCode: string
}

export default function Item({ item, type = "full", currencyCode }: ItemProps) {
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changeQuantity = async (quantity: number) => {
    setError(null)
    setUpdating(true)

    await updateLineItem({ lineId: item.id, quantity })
      .catch((err: Error) => {
        toast.error("수량 변경에 실패했습니다")
        setError(err.message)
      })
      .finally(() => setUpdating(false))

    setUpdating(false)
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteLineItem(item.id)
    } catch {
      toast.error("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.")
    } finally {
      setDeleting(false)
    }
  }

  // 재고 관리 활성화: 실제 재고 수량 기반 (최대 99개)
  // 재고 관리 비활성화: 99개까지 허용
  const maxQuantity = item.variant?.manage_inventory
    ? Math.min(item.variant.inventory_quantity ?? 99, 99)
    : 99

  const unitPrice = item.unit_price ?? 0
  const compareAtUnitPrice = item.compare_at_unit_price
  const totalPrice = unitPrice * item.quantity

  // 할인율 계산 (compare_at_unit_price가 있고, unit_price보다 클 때만)
  const discountPercentage =
    compareAtUnitPrice && compareAtUnitPrice > unitPrice
      ? Math.round((1 - unitPrice / compareAtUnitPrice) * 100)
      : 0
  const compareAtTotalPrice = compareAtUnitPrice
    ? compareAtUnitPrice * item.quantity
    : 0

  return (
    <TableRow className="w-full" data-testid="product-row">
      {/* 썸네일 */}
      <TableCell className="w-24 p-4 pl-0">
        <LocalizedClientLink
          href={`/products/${item.product_handle}`}
          className={cn("flex", {
            "w-16": type === "preview",
            "w-12 sm:w-24": type === "full",
          })}
        >
          {item.thumbnail ? (
            <Image
              src={getThumbnailUrl(item.thumbnail)}
              alt={item.product_title ?? ""}
              width={96}
              height={96}
              className="aspect-square rounded-md object-cover"
            />
          ) : (
            <div className="bg-muted flex aspect-square w-full items-center justify-center rounded-md">
              <span className="text-muted-foreground text-xs">No image</span>
            </div>
          )}
        </LocalizedClientLink>
      </TableCell>

      {/* 상품명 & 옵션 */}
      <TableCell className="text-left">
        <p className="text-sm font-medium" data-testid="product-title">
          {item.product_title}
        </p>
        {item.variant?.title && item.variant.title !== "Default Title" && (
          <p className="text-muted-foreground mt-1 text-xs">
            {item.variant.title}
          </p>
        )}
      </TableCell>

      {/* 수량 선택 (full 모드만) */}
      {type === "full" && (
        <TableCell>
          <div className="flex w-28 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleDelete}
              disabled={deleting}
              data-testid="product-delete-button"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>

            <Select
              value={String(item.quantity)}
              onValueChange={(value) => changeQuantity(parseInt(value))}
              data-testid="product-select-button"
            >
              <SelectTrigger className="h-10 w-14">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {Array.from({ length: maxQuantity }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {updating && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
          {error && (
            <p
              className="text-destructive mt-1 text-xs"
              data-testid="product-error-message"
            >
              {error}
            </p>
          )}
        </TableCell>
      )}

      {/* 단가 (full 모드, sm 이상에서만) */}
      {type === "full" && (
        <TableCell className="hidden sm:table-cell">
          <div className="flex flex-col items-start">
            {discountPercentage > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground text-xs line-through">
                  {formatPrice(compareAtUnitPrice!)}원
                </span>
                <span className="text-destructive text-xs font-medium">
                  {discountPercentage}%
                </span>
              </div>
            )}
            <span className="text-sm">{formatPrice(unitPrice)}원</span>
          </div>
        </TableCell>
      )}

      {/* 합계 */}
      <TableCell className="pr-0 text-right">
        <div
          className={cn("flex flex-col items-end", {
            "justify-center": type === "preview",
          })}
        >
          {type === "preview" && (
            <span className="flex gap-x-1">
              <span className="text-muted-foreground">{item.quantity}x</span>
              <span className="text-sm">{formatPrice(unitPrice)}원</span>
            </span>
          )}
          {discountPercentage > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground text-xs line-through">
                {formatPrice(compareAtTotalPrice)}원
              </span>
              <span className="text-destructive text-xs font-medium">
                {discountPercentage}%
              </span>
            </div>
          )}
          <span className="text-sm font-medium">
            {formatPrice(totalPrice)}원
          </span>
        </div>
      </TableCell>
    </TableRow>
  )
}
