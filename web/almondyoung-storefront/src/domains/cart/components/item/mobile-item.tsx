"use client"

import { useState } from "react"
import Image from "next/image"
import { Loader2, Minus, Plus, Trash2 } from "lucide-react"
import { HttpTypes } from "@medusajs/types"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { deleteLineItem, updateLineItem } from "@/lib/api/medusa/cart"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { formatPrice } from "@/lib/utils/price-utils"

type MobileItemProps = {
  item: HttpTypes.StoreCartLineItem
}

export default function MobileItem({ item }: MobileItemProps) {
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const changeQuantity = async (quantity: number) => {
    if (quantity < 1 || quantity > maxQuantity) return
    setUpdating(true)
    await updateLineItem({ lineId: item.id, quantity })
      .catch(() => {
        toast.error("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.")
      })
      .finally(() => setUpdating(false))
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value === "") return
    const num = parseInt(value)
    if (!isNaN(num) && num >= 1 && num <= maxQuantity) {
      changeQuantity(num)
    }
  }

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value === "" || parseInt(value) < 1) {
      e.target.value = String(item.quantity)
    }
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
            <p className="line-clamp-2 text-sm leading-snug font-medium">
              {item.product_title}
            </p>
            {item.variant?.options && item.variant.options.length > 0 && (
              <p className="text-muted-foreground mt-0.5 text-xs">
                {item.variant.options
                  .map((opt) => `${opt.option?.title}: ${opt.value}`)
                  .join(" / ")}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground -mt-1 -mr-2 h-8 w-8 shrink-0"
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
          <div className="border-input relative flex h-8 items-center rounded-lg border bg-white">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-8 rounded-l-lg rounded-r-none"
              onClick={() => changeQuantity(item.quantity - 1)}
              disabled={updating || item.quantity <= 1}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <input
              type="number"
              min={1}
              max={maxQuantity}
              defaultValue={item.quantity}
              key={item.quantity}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              className="h-full w-8 border-none bg-transparent text-center text-sm font-medium outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              disabled={updating}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-8 rounded-l-none rounded-r-lg"
              onClick={() => changeQuantity(item.quantity + 1)}
              disabled={updating || item.quantity >= maxQuantity}
            >
              <Plus className="h-4 w-4" />
            </Button>
            {updating && (
              <div className="bg-background/80 absolute inset-0 flex items-center justify-center rounded-lg">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
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
