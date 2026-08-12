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
import {
  isInsufficientInventoryError,
  resolveStockNotice,
} from "@/lib/utils/cart-availability"
import { resolveQuantityChange } from "@/lib/utils/cart-quantity"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { formatPrice } from "@/lib/utils/price-utils"
import { HttpTypes } from "@medusajs/types"
import { Loader2, Minus, Plus, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import Image from "next/image"
import { cloneElement, ReactElement, useState, useTransition } from "react"
import { toast } from "sonner"

/**
 * 구매 불가 사유. 상품이 통째로 내려간 것(`product`)과 그 옵션만 없어진 것(`option`)은
 * 고객이 할 수 있는 일이 다르다 — 후자는 다른 옵션으로 다시 담으면 된다.
 */
type UnavailableReason = "product" | "option" | "soldOut"

const unavailableBadgeKey = (reason?: UnavailableReason) =>
  reason === "option"
    ? "optionGoneBadge"
    : reason === "soldOut"
      ? "outOfStockBadge"
      : "soldOutBadge"

const unavailableHintKey = (reason?: UnavailableReason) =>
  reason === "option"
    ? "optionGoneHint"
    : reason === "soldOut"
      ? "outOfStockHint"
      : "soldOutHint"

type ItemProps = {
  item: HttpTypes.StoreCartLineItem
  children: ReactElement
  selected?: boolean
  onSelectChange?: (checked: boolean) => void
  selectDisabled?: boolean
  /** 판매중단(draft/미게시)으로 결제를 막는 상품이면 true */
  isUnavailable?: boolean
  /** 상품이 통째로 내려갔는지, 그 옵션만 없어졌는지 */
  unavailableReason?: UnavailableReason
  /** 남은 재고. 없으면(재고 미추적/백오더) 수량 상한이 없다는 뜻 */
  maxQuantity?: number
}

type ItemChildProps = {
  item: HttpTypes.StoreCartLineItem
  deleting: boolean
  isPending: boolean
  error: string | null
  unitPrice: number
  compareAtUnitPrice: number | null | undefined
  totalPrice: number
  discountPercentage: number
  compareAtTotalPrice: number
  changeQuantity: (quantity: number) => boolean
  handleDelete: () => Promise<void>
  selected?: boolean
  onSelectChange?: (checked: boolean) => void
  selectDisabled?: boolean
  isUnavailable?: boolean
  unavailableReason?: UnavailableReason
  maxQuantity?: number
}

type DesktopItemProps = Partial<ItemChildProps> & {
  type?: "full" | "preview"
}

type MobileItemProps = Partial<ItemChildProps>

function Item({
  item,
  children,
  selected,
  onSelectChange,
  selectDisabled,
  isUnavailable,
  unavailableReason,
  maxQuantity,
}: ItemProps) {
  const t = useTranslations("cart.items")
  const [isPending, startTransition] = useTransition()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 요청을 서버로 보냈으면 true. 상한/품절로 막았으면 false (다이얼로그를 닫지 않기 위해). */
  const changeQuantity = (quantity: number): boolean => {
    // 남은 재고를 넘기면 서버에 보내기 전에 남은 수량을 알려준다. 그대로 보내면 Medusa 가
    // 영문 재고부족 에러(`Some variant does not have the required inventory`)를 던지고,
    // 그게 그대로 토스트에 떠서 고객이 무슨 상황인지 알 수 없었다.
    const change = resolveQuantityChange({
      requested: quantity,
      current: item.quantity,
      maxQuantity,
    })

    if (change.type === "reject") {
      if (change.reason === "belowMin") return false

      // 재고 0 은 "0개 이하로 담아주세요" 가 되어버리므로 품절 문구를 쓴다. 품절 라인은
      // 줄이는 것도 서버가 거절하므로, 줄이려던 고객에게는 "늘릴 수 없다" 가 아니라
      // 빼달라고 말해야 한다.
      const message =
        change.reason === "soldOut"
          ? change.isIncrease
            ? t("quantitySoldOut")
            : t("outOfStockHint")
          : t("quantityMaxError", { max: change.max })
      toast.error(message)
      setError(message)
      return false
    }

    setError(null)

    // 상한을 넘긴 라인에서 줄이는 요청은 상한까지 내려간다. 바뀐 수량을 알려주지 않으면
    // "-" 를 눌렀는데 숫자가 여러 칸 떨어진 것처럼 보인다.
    if (change.clampedToMax) {
      toast.info(t("quantityAdjustedToMax", { max: change.quantity }))
    }

    startTransition(async () => {
      try {
        await updateLineItem({ lineId: item.id, quantity: change.quantity })
      } catch (err) {
        const raw = err instanceof Error ? err.message : ""
        // 재고 정보가 방금 바뀌어 상한 검사를 통과했는데도 실패한 경우. 백엔드가 한글로 던진
        // 메시지(멤버십 제한 등)는 사용자용이라 그대로 쓰고, 그 외 영문 원문은 노출하지 않는다.
        const message = isInsufficientInventoryError(raw)
          ? t("quantityStockError")
          : /[가-힣]/.test(raw)
            ? raw
            : t("quantityUpdateFail")
        if (raw && !isInsufficientInventoryError(raw)) {
          console.error("[cart] 수량 변경 실패:", raw)
        }
        toast.error(message)
        setError(message)
      }
    })

    return true
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteLineItem(item.id)
    } catch {
      toast.error(t("deleteItemError"))
    } finally {
      setDeleting(false)
    }
  }

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

  return cloneElement(children, {
    item,
    deleting,
    isPending,
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
    isUnavailable,
    unavailableReason,
    maxQuantity,
  } as ItemChildProps)
}

function DesktopItem({
  item,
  type = "full",
  deleting,
  isPending,
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
  isUnavailable,
  unavailableReason,
  maxQuantity,
}: DesktopItemProps) {
  const t = useTranslations("cart.items")
  const tCart = useTranslations("cart")
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
      return toast.error(t("quantityMinError"))
    }

    // 상한 판정과 안내는 changeQuantity 가 한다. 막힌 경우엔 다이얼로그를 닫지 않아
    // 고객이 바로 고쳐 넣을 수 있게 한다.
    if (changeQuantity?.(num)) {
      setIsModalOpen(false)
    }
  }

  // 판매중단 라인은 이미 별도 배지가 있으므로 재고 안내를 겹쳐 띄우지 않는다.
  const stockNotice = isUnavailable
    ? null
    : resolveStockNotice(item?.quantity ?? 0, maxQuantity)

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
              <span className="text-muted-foreground text-xs">
                {t("noImage")}
              </span>
            </div>
          )}
        </LocalizedClientLink>
      </TableCell>

      {/* 상품명 & 옵션 */}
      <TableCell className="text-left">
        {isUnavailable && (
          <p className="mb-1 text-xs font-semibold text-red-600">
            {t(unavailableBadgeKey(unavailableReason))}
          </p>
        )}
        {stockNotice?.kind === "overStock" && (
          <p className="mb-1 text-xs font-semibold text-red-600">
            {t("overStockBadge")}
          </p>
        )}
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
        {isUnavailable && (
          <p className="mt-1 text-xs text-red-600">
            {t(unavailableHintKey(unavailableReason))}
          </p>
        )}
        {stockNotice?.kind === "overStock" && (
          <p className="mt-1 text-xs text-red-600">
            {t("overStockHint", { max: stockNotice.max })}
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
              disabled={item.quantity <= 1 || isPending}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={handleOpenModal}
              disabled={isPending}
              className="hover:bg-gray-10 h-full w-10 cursor-pointer text-center text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="product-quantity-input"
            >
              {isPending ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                item.quantity
              )}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-9 rounded-l-none rounded-r-lg"
              onClick={() => changeQuantity?.(item.quantity + 1)}
              disabled={isPending}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {stockNotice?.kind === "atLimit" && (
            <p className="text-muted-foreground mt-1 text-xs">
              {t("quantityMaxHint", { max: stockNotice.max })}
            </p>
          )}

          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogContent showCloseButton={false} className="max-w-xs">
              <DialogHeader>
                <DialogTitle className="text-center">
                  {t("quantityDialogTitle")}
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
                  {t("cancel")}
                </Button>
                <Button className="h-11" onClick={handleConfirm}>
                  {t("confirm")}
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
                  {formatPrice(compareAtUnitPrice!)}
                  {tCart("won")}
                </span>
                <span className="text-destructive text-xs font-medium">
                  {discountPercentage}%
                </span>
              </div>
            )}
            <span className="text-sm">
              {formatPrice(unitPrice ?? 0)}
              {tCart("won")}
            </span>
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
              <span className="text-sm">
                {formatPrice(unitPrice ?? 0)}
                {tCart("won")}
              </span>
            </span>
          )}
          {(discountPercentage ?? 0) > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground text-xs line-through">
                {formatPrice(compareAtTotalPrice ?? 0)}
                {tCart("won")}
              </span>
              <span className="text-destructive text-xs font-medium">
                {discountPercentage}%
              </span>
            </div>
          )}
          <span className="text-sm font-medium">
            {formatPrice(totalPrice ?? 0)}
            {tCart("won")}
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
  isPending,
  totalPrice,
  discountPercentage,
  changeQuantity,
  handleDelete,
  isUnavailable,
  unavailableReason,
  maxQuantity,
}: MobileItemProps) {
  const t = useTranslations("cart.items")
  const tCart = useTranslations("cart")
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
      return toast.error(t("quantityMinError"))
    }

    // 상한 판정과 안내는 changeQuantity 가 한다. 막힌 경우엔 다이얼로그를 닫지 않아
    // 고객이 바로 고쳐 넣을 수 있게 한다.
    if (changeQuantity?.(num)) {
      setIsModalOpen(false)
    }
  }

  // 판매중단 라인은 이미 별도 배지가 있으므로 재고 안내를 겹쳐 띄우지 않는다.
  const stockNotice = isUnavailable
    ? null
    : resolveStockNotice(item?.quantity ?? 0, maxQuantity)

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
            <span className="text-muted-foreground text-xs">
              {t("noImage")}
            </span>
          </div>
        )}
      </LocalizedClientLink>

      {/* 상품 정보 & 컨트롤 */}
      <div className="flex flex-1 flex-col">
        {/* 상단: 상품명 + 삭제버튼 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            {isUnavailable && (
              <p className="mb-0.5 text-xs font-semibold text-red-600">
                {t(unavailableBadgeKey(unavailableReason))}
              </p>
            )}
            {stockNotice?.kind === "overStock" && (
              <p className="mb-0.5 text-xs font-semibold text-red-600">
                {t("overStockBadge")}
              </p>
            )}
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
            {isUnavailable && (
              <p className="mt-0.5 text-xs text-red-600">
                {t(unavailableHintKey(unavailableReason))}
              </p>
            )}
            {stockNotice?.kind === "overStock" && (
              <p className="mt-0.5 text-xs text-red-600">
                {t("overStockHint", { max: stockNotice.max })}
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
              disabled={item.quantity <= 1 || isPending}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={handleOpenModal}
              disabled={isPending}
              className="h-full w-8 text-center text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                item.quantity
              )}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-full w-8 rounded-l-none rounded-r-lg"
              onClick={() => changeQuantity?.(item.quantity + 1)}
              disabled={isPending}
            >
              <Plus className="h-4 w-4" />
            </Button>
            {stockNotice?.kind === "atLimit" && (
              <span className="text-muted-foreground ml-2 text-xs">
                {t("quantityMaxHint", { max: stockNotice.max })}
              </span>
            )}
          </div>

          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogContent showCloseButton={false} className="max-w-xs">
              <DialogHeader>
                <DialogTitle className="text-center">
                  {t("quantityDialogTitle")}
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
                  {t("cancel")}
                </Button>
                <Button className="h-11" onClick={handleConfirm}>
                  {t("confirm")}
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
              {formatPrice(totalPrice ?? 0)}
              {tCart("won")}
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
