"use client"

import { useState } from "react"
import Image from "next/image"
import { Loader2, Trash2 } from "lucide-react"
import { HttpTypes } from "@medusajs/types"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { deleteLineItem, updateLineItem } from "@/lib/api/medusa/cart"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { formatPrice } from "@/lib/utils/price-utils"

type MobileItemProps = {
  item: HttpTypes.StoreCartLineItem
  currencyCode: string
}

export default function MobileItem({ item }: MobileItemProps) {
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const changeQuantity = async (quantity: number) => {
    setUpdating(true)
    await updateLineItem({ lineId: item.id, quantity })
      .catch(() => {
        toast.error("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.")
      })
      .finally(() => setUpdating(false))
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

  const maxQuantity = item.variant?.manage_inventory
    ? Math.min(item.variant.inventory_quantity ?? 99, 99)
    : 99

  const unitPrice = item.unit_price ?? 0
  const compareAtUnitPrice = item.compare_at_unit_price
  const totalPrice = unitPrice * item.quantity

  const discountPercentage =
    compareAtUnitPrice && compareAtUnitPrice > unitPrice
      ? Math.round((1 - unitPrice / compareAtUnitPrice) * 100)
      : 0

  return (
    <div className="flex gap-3 border-b py-4">
      {/* 썸네일 */}
      <LocalizedClientLink
        href={`/products/${item.product_handle}`}
        className="shrink-0"
      >
        {item.thumbnail ? (
          <Image
            src={getThumbnailUrl(item.thumbnail)}
            alt={item.product_title ?? ""}
            width={72}
            height={72}
            className="aspect-square rounded-md object-cover"
          />
        ) : (
          <div className="bg-muted flex h-[72px] w-[72px] items-center justify-center rounded-md">
            <span className="text-muted-foreground text-xs">No image</span>
          </div>
        )}
      </LocalizedClientLink>

      {/* 상품 정보 & 컨트롤 */}
      <div className="flex flex-1 flex-col">
        {/* 상단: 상품명 + 삭제버튼 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="line-clamp-2 text-sm font-medium leading-snug">
              {item.product_title}
            </p>
            {item.variant?.title && item.variant.title !== "Default Title" && (
              <p className="text-muted-foreground mt-0.5 text-xs">
                {item.variant.title}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground -mr-2 -mt-1 h-8 w-8 shrink-0"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* 하단: 수량 + 가격 */}
        <div className="mt-auto flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <Select
              value={String(item.quantity)}
              onValueChange={(value) => changeQuantity(parseInt(value))}
            >
              <SelectTrigger className="h-7 w-14 text-xs">
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

          <div className="text-right">
            {discountPercentage > 0 && (
              <span className="text-destructive mr-1 text-xs font-medium">
                {discountPercentage}%
              </span>
            )}
            <span className="text-sm font-semibold">
              {formatPrice(totalPrice)}원
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
