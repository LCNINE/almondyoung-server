"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { deleteLineItem, updateLineItem } from "@/lib/api/medusa/cart"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { formatPrice } from "@/lib/utils/price-utils"
import { HttpTypes } from "@medusajs/types"
import { Loader2, Minus, Plus, Trash2 } from "lucide-react"
import Image from "next/image"
import {
  cloneElement,
  ReactElement,
  useOptimistic,
  useState,
  useTransition,
} from "react"
import { toast } from "sonner"

type ItemProps = {
  item: HttpTypes.StoreCartLineItem
  children: ReactElement
  selected?: boolean
  onSelectChange?: (checked: boolean) => void
  selectDisabled?: boolean
}

type ItemChildProps = {
  item: HttpTypes.StoreCartLineItem
  deleting: boolean
  error: string | null
  unitPrice: number
  compareAtUnitPrice: number | null | undefined
  totalPrice: number
  discountPercentage: number
  compareAtTotalPrice: number
  changeQuantity: (quantity: number) => Promise<void>
  handleDelete: () => Promise<void>
  selected?: boolean
  onSelectChange?: (checked: boolean) => void
  selectDisabled?: boolean
}

type DesktopItemProps = Partial<ItemChildProps> & {
  type?: "full" | "preview"
  selected?: boolean
  onSelectChange?: (checked: boolean) => void
  selectDisabled?: boolean
}

type MobileItemProps = Partial<ItemChildProps>

function Item({
  item,
  children,
  selected,
  onSelectChange,
  selectDisabled,
}: ItemProps) {
  const [optimisticQuantity, setOptimisticQuantity] = useOptimistic(
    item.quantity
  )
  const [, startTransition] = useTransition()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changeQuantity = (quantity: number) => {
    if (quantity < 1) return
    setError(null)

    startTransition(async () => {
      setOptimisticQuantity(quantity) // 즉시 UI 반영

      try {
        await updateLineItem({ lineId: item.id, quantity })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "수량 변경에 실패했습니다"
        toast.error(message)
        setError(message)
      }
    })
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

  const unitPrice = item.unit_price ?? 0
  const compareAtUnitPrice = item.compare_at_unit_price
  const totalPrice = unitPrice * optimisticQuantity

  // 할인율 계산 (compare_at_unit_price가 있고, unit_price보다 클 때만)
  const discountPercentage =
    compareAtUnitPrice && compareAtUnitPrice > unitPrice
      ? Math.round((1 - unitPrice / compareAtUnitPrice) * 100)
      : 0
  const compareAtTotalPrice = compareAtUnitPrice
    ? compareAtUnitPrice * optimisticQuantity
    : 0

  const optimisticItem = { ...item, quantity: optimisticQuantity }

  return cloneElement(children, {
    item: optimisticItem,
    deleting,
    error,
    unitPrice,
    compareAtUnitPrice,
    totalPrice,
    discountPercentage,
    compareAtTotalPrice,
    changeQuantity,
    handleDelete,
    selected,
    onSelectChange,
    selectDisabled,
  } as ItemChildProps)
}

function DesktopItem({
  item,
  type = "full",
  deleting,
  error,
  unitPrice,
  compareAtUnitPrice,
  totalPrice,
  discountPercentage,
  compareAtTotalPrice,
  changeQuantity,
  handleDelete,
  selected,
  onSelectChange,
  selectDisabled,
}: DesktopItemProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [inputQuantity, setInputQuantity] = useState("")

  if (!item) return null

  const handleOpenModal = () => {
    setInputQuantity(String(item.quantity))
    setIsModalOpen(true)
  }

  const handleConfirm = async () => {
    const num = parseInt(inputQuantity)

    if (isNaN(num) || num < 1) {
      return toast.error("수량은 1개 이상이어야 합니다.")
    }

    await changeQuantity?.(num)
    setIsModalOpen(false)
  }

  return (
    <TableRow className="w-full" data-testid="product-row">
      {/* 체크박스 (full 모드만) */}
      {type === "full" && (
        <TableCell className="w-10 pl-0">
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelectChange?.(checked === true)}
            disabled={selectDisabled}
          />
        </TableCell>
      )}
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
        {item.variant?.options && item.variant.options.length > 0 && (
          <p className="text-muted-foreground mt-1 text-xs">
            {item.variant.options
              .map((opt) => `${opt.option?.title}: ${opt.value}`)
              .join(" / ")}
          </p>
        )}
      </TableCell>

      {/* 수량 선택 (full 모드만) */}
      {type === "full" && (
        <TableCell>
          <div className="border-input flex h-9 items-center rounded-lg border bg-white">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-9 rounded-l-lg rounded-r-none"
              onClick={() => changeQuantity?.(item.quantity - 1)}
              disabled={item.quantity <= 1}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={handleOpenModal}
              className="hover:bg-gray-10 h-full w-10 cursor-pointer text-center text-sm font-medium"
              data-testid="product-quantity-input"
            >
              {item.quantity}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-9 rounded-l-none rounded-r-lg"
              onClick={() => changeQuantity?.(item.quantity + 1)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogContent showCloseButton={false} className="max-w-xs">
              <DialogHeader>
                <DialogTitle className="text-center">
                  수량을 입력해주세요
                </DialogTitle>
              </DialogHeader>
              <Input
                type="number"
                min={1}
                value={inputQuantity}
                onChange={(e) => setInputQuantity(e.target.value)}
                className="focus:border-primary focus:ring-primary h-12 [appearance:textfield] text-center text-lg [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                autoFocus
              />
              <DialogFooter className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => setIsModalOpen(false)}
                >
                  취소
                </Button>
                <Button className="h-11" onClick={handleConfirm}>
                  확인
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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

      {/* 단가 (full 모드, xl 이상에서만) */}
      {type === "full" && (
        <TableCell className="hidden xl:table-cell">
          <div className="flex flex-col items-start whitespace-nowrap">
            {(discountPercentage ?? 0) > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground text-xs line-through">
                  {formatPrice(compareAtUnitPrice!)}원
                </span>
                <span className="text-destructive text-xs font-medium">
                  {discountPercentage}%
                </span>
              </div>
            )}
            <span className="text-sm">{formatPrice(unitPrice ?? 0)}원</span>
          </div>
        </TableCell>
      )}

      {/* 합계 */}
      <TableCell className="text-right">
        <div
          className={cn("flex flex-col items-end whitespace-nowrap", {
            "justify-center": type === "preview",
          })}
        >
          {type === "preview" && (
            <span className="flex gap-x-1">
              <span className="text-muted-foreground">{item.quantity}x</span>
              <span className="text-sm">{formatPrice(unitPrice ?? 0)}원</span>
            </span>
          )}
          {(discountPercentage ?? 0) > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground text-xs line-through">
                {formatPrice(compareAtTotalPrice ?? 0)}원
              </span>
              <span className="text-destructive text-xs font-medium">
                {discountPercentage}%
              </span>
            </div>
          )}
          <span className="text-sm font-medium">
            {formatPrice(totalPrice ?? 0)}원
          </span>
        </div>
      </TableCell>

      {/* 삭제 버튼 (full 모드만) */}
      {type === "full" && (
        <TableCell className="pr-0">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground h-8 w-8"
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
        </TableCell>
      )}
    </TableRow>
  )
}

function MobileItem({
  item,
  deleting,
  totalPrice,
  discountPercentage,
  changeQuantity,
  handleDelete,
}: MobileItemProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [inputQuantity, setInputQuantity] = useState("")

  if (!item) return null

  const handleOpenModal = () => {
    setInputQuantity(String(item.quantity))
    setIsModalOpen(true)
  }

  const handleConfirm = async () => {
    const num = parseInt(inputQuantity)

    if (isNaN(num) || num < 1) {
      return toast.error("수량은 1개 이상이어야 합니다.")
    }

    await changeQuantity?.(num)
    setIsModalOpen(false)
  }

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
          <div className="border-input flex h-8 items-center rounded-lg border bg-white">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-8 rounded-l-lg rounded-r-none"
              onClick={() => changeQuantity?.(item.quantity - 1)}
              disabled={item.quantity <= 1}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={handleOpenModal}
              className="h-full w-8 text-center text-sm font-medium hover:bg-gray-50"
            >
              {item.quantity}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-8 rounded-l-none rounded-r-lg"
              onClick={() => changeQuantity?.(item.quantity + 1)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogContent showCloseButton={false} className="max-w-xs">
              <DialogHeader>
                <DialogTitle className="text-center">
                  수량을 입력해주세요
                </DialogTitle>
              </DialogHeader>
              <Input
                type="number"
                min={1}
                value={inputQuantity}
                onChange={(e) => setInputQuantity(e.target.value)}
                className="focus:border-primary focus:ring-primary h-12 [appearance:textfield] text-center text-lg [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                autoFocus
              />
              <DialogFooter className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => setIsModalOpen(false)}
                >
                  취소
                </Button>
                <Button className="h-11" onClick={handleConfirm}>
                  확인
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="text-right">
            {(discountPercentage ?? 0) > 0 && (
              <span className="text-destructive mr-1 text-xs font-medium">
                {discountPercentage}%
              </span>
            )}
            <span className="text-sm font-semibold">
              {formatPrice(totalPrice ?? 0)}원
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

Item.Desktop = DesktopItem
Item.Mobile = MobileItem

export default Item
