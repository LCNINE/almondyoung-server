"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { deleteLineItem, updateLineItem } from "@/lib/api/medusa/cart"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { calcItemPrice, formatPrice } from "@/lib/utils/price-utils"
import { StoreCart, StoreCartLineItem } from "@medusajs/types"
import { Minus, Plus, Trash2, X } from "lucide-react"
import Image from "next/image"
import { useState, useTransition } from "react"
import { toast } from "sonner"

interface OrderProductsSectionProps {
  cartId: string
  products: StoreCart["items"]
  shipping: number
  selectedIds: Set<string>
  onSelectedIdsChange: (ids: Set<string>) => void
}

export const OrderProductsSection = ({
  cartId,
  products,
  shipping,
  selectedIds,
  onSelectedIdsChange,
}: OrderProductsSectionProps) => {
  const [isPending, startTransition] = useTransition()

  if (!products?.length) {
    return (
      <section aria-labelledby="order-heading" className="mb-8">
        <h2
          id="order-heading"
          className="mb-3 text-base font-bold text-gray-900 lg:text-xl"
        >
          주문 상품
        </h2>
        <article className="rounded-md border border-gray-200 bg-white p-4 lg:rounded-[10px] lg:p-10">
          <p className="text-center text-gray-500">주문 상품이 없습니다.</p>
        </article>
      </section>
    )
  }

  const allSelected = selectedIds.size === products.length
  const someSelected = selectedIds.size > 0

  const toggleAll = () => {
    if (allSelected) {
      onSelectedIdsChange(new Set())
    } else {
      onSelectedIdsChange(new Set(products.map((item) => item.id)))
    }
  }

  const toggleItem = (id: string) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    onSelectedIdsChange(newSet)
  }

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return

    startTransition(async () => {
      try {
        await Promise.all(
          Array.from(selectedIds).map((id) => deleteLineItem(id, cartId))
        )
        toast.success(`${selectedIds.size}개 상품이 삭제되었습니다.`)
        onSelectedIdsChange(new Set())
      } catch {
        toast.error("상품 삭제에 실패했습니다.")
      }
    })
  }

  return (
    <section aria-labelledby="order-heading" className="mb-8">
      <h2
        id="order-heading"
        className="mb-3 text-base font-bold text-gray-900 lg:text-xl"
      >
        주문 상품
      </h2>
      <article className="rounded-md border border-gray-200 bg-white lg:rounded-[10px]">
        {/* 전체 선택 & 선택 삭제 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-100 px-[14px] py-3 lg:px-10">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              disabled={isPending}
            />
            <span className="text-[12px] text-gray-700 lg:text-sm">
              전체 선택 ({selectedIds.size}/{products.length})
            </span>
          </label>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[12px] text-gray-500 hover:text-red-500 lg:text-sm"
                disabled={!someSelected || isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                선택 삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>선택 상품 삭제</AlertDialogTitle>
                <AlertDialogDescription>
                  선택한 {selectedIds.size}개의 상품을 장바구니에서
                  삭제하시겠습니까?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-500 hover:bg-red-600"
                  onClick={handleDeleteSelected}
                  disabled={isPending}
                >
                  {isPending ? "삭제중..." : "삭제"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* 상품 목록 */}
        <div className="space-y-4 px-[14px] py-[18px] lg:px-10 lg:py-8">
          {products.map((item, i) => (
            <ProductItem
              key={item.id}
              item={item}
              cartId={cartId}
              showDivider={i < products.length - 1}
              isSelected={selectedIds.has(item.id)}
              onToggle={() => toggleItem(item.id)}
              disabled={isPending}
            />
          ))}
        </div>

        {/* 배송비 */}
        <div className="border-t border-gray-100 px-[14px] py-3 lg:px-10">
          <p className="text-right text-[12px] text-gray-600 lg:text-sm">
            배송비 {formatPrice(shipping)}원
          </p>
        </div>
      </article>
    </section>
  )
}

function ProductItem({
  item,
  cartId,
  showDivider,
  isSelected,
  onToggle,
  disabled,
}: {
  item: StoreCartLineItem
  cartId: string
  showDivider: boolean
  isSelected: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const {
    thumbnail,
    product_title,
    title,
    variant_title,
    subtitle,
    quantity,
    unit_price,
    id,
  } = item
  const productTitle = product_title ?? title
  const { total, originalTotal, hasReducedPrice } = calcItemPrice(item)

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deleteLineItem(id, cartId)
        toast.success("상품이 삭제되었습니다.")
      } catch {
        toast.error("상품 삭제에 실패했습니다.")
      }
    })
  }
  return (
    <div className={showDivider ? "border-b border-gray-100 pb-4" : ""}>
      <div className="flex items-start gap-3 lg:gap-4">
        {/* 체크박스 */}
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          disabled={disabled || isPending}
          className="mt-1"
        />
        <div className="relative h-[52px] w-[52px] lg:h-[64px] lg:w-[64px]">
          <Image
            src={getThumbnailUrl(thumbnail ?? "")}
            fill
            alt={productTitle}
            sizes="(max-width: 1024px) 52px, 64px"
            className="pointer-events-none rounded-[2px] object-cover select-none lg:rounded-[5px]"
          />
        </div>
        <p className="flex-1 text-[12px] text-gray-900 lg:text-sm">
          {productTitle}
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-gray-400 hover:text-gray-600"
              disabled={isPending}
            >
              <X className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>상품 삭제</AlertDialogTitle>
              <AlertDialogDescription>
                {productTitle} 상품을 장바구니에서 삭제하시겠습니까?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                className="bg-yellow-30 hover:bg-yellow-40"
                onClick={handleDelete}
                disabled={isPending}
              >
                {isPending ? "삭제중..." : "삭제"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className="mt-3 ml-7 lg:ml-8">
        <div className="flex items-center justify-between rounded-[2px] bg-[#F5F5F5]/50 px-2 py-2 lg:px-3 lg:py-2.5">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-[2px] border-gray-200 bg-white px-1 py-0 text-[11px] font-medium text-gray-600"
            >
              옵션
            </Badge>
            <span className="text-[12px] text-gray-600 lg:text-sm">
              {variant_title ?? subtitle ?? "기본"} | {quantity}개
            </span>
          </div>
          <div className="flex items-center gap-2">
            <QuantityEditPopover
              itemId={id}
              cartId={cartId}
              currentQuantity={quantity}
              unitPrice={unit_price}
            />
            <PriceDisplay
              hasDiscount={hasReducedPrice}
              originalPrice={originalTotal}
              price={total}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function QuantityEditPopover({
  itemId,
  cartId,
  currentQuantity,
  unitPrice,
}: {
  itemId: string
  cartId: string
  currentQuantity: number
  unitPrice: number
}) {
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState(currentQuantity)
  const [isPending, startTransition] = useTransition()

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) setQuantity(currentQuantity)
    setOpen(isOpen)
  }

  const handleSave = () => {
    if (quantity === currentQuantity) return setOpen(false)
    startTransition(async () => {
      try {
        await updateLineItem({ lineId: itemId, quantity, cartId })
        toast.success("수량이 변경되었습니다.")
        setOpen(false)
      } catch {
        toast.error("수량 변경에 실패했습니다.")
      }
    })
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px] text-gray-600"
        >
          변경
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-3 p-3">
        <p className="text-sm font-medium">수량 변경</p>
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={isPending || quantity <= 1}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="min-w-[40px] text-center text-lg font-medium">
            {quantity}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setQuantity((q) => q + 1)}
            disabled={isPending}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-center text-sm text-gray-500">
          예상 금액:{" "}
          <span className="font-medium text-gray-900">
            {formatPrice(unitPrice * quantity)}원
          </span>
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            취소
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={handleSave}
            disabled={isPending}
          >
            {isPending ? "저장중..." : "저장"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PriceDisplay({
  hasDiscount,
  originalPrice,
  price,
}: {
  hasDiscount: boolean
  originalPrice?: number | null
  price: number
}) {
  return (
    <div className="flex items-center gap-1.5 text-right">
      {hasDiscount && (
        <span className="text-[12px] text-gray-400 line-through lg:text-sm">
          {formatPrice(originalPrice)}
        </span>
      )}
      <span className="text-[13px] font-medium text-gray-900 lg:text-base">
        {formatPrice(price)}원
      </span>
    </div>
  )
}
