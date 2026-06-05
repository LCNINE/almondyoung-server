"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAddToCart } from "@/hooks/api/use-add-to-cart"
import { captureOrderPayment } from "@/lib/api/medusa/orders"
import { cancelOrderByMedusaId, type StoreOrderAction, type StoreCancelUnavailableReason } from "@/lib/api/orders/store-orders"
import type { StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"
import { OrderStatusBadges, CANCEL_UNAVAILABLE_MESSAGES, getCoreDisplayStatus } from "@/components/orders/order-status-badges"
import { CancelReasonForm, type CancelReasonCode } from "@/components/orders/cancel-reason-form"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { ExternalLink, MoreVertical, Package, RefreshCw, RotateCcw, ShoppingCart } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

interface OrderCardContentProps {
  orderId: string
  status: string
  paymentStatus: string
  deliveryInfo?: string
  shippingNote?: string
  productName: string
  productImage: string
  price: string
  quantity: number | string
  options?: string[]
  showInquiry?: boolean
  orderItems?: Array<{ productId: string; orderLineId: string }>
  variantId: string
  /** Core 액션 목록. undefined이면 Medusa 상태 기반 fallback 사용. */
  /** Core actions 전체 응답. 있으면 badge·버튼 조건에 사용 */
  coreActions?: StoreOrderActionsResponse
  /** 하위 호환 */
  availableActions?: StoreOrderAction[]
  cancelUnavailableReason?: StoreCancelUnavailableReason
  channelInfo?: { channel: string; cancelUrl?: string; returnUrl?: string }
}

export default function OrderCardContent({
  orderId,
  status,
  paymentStatus,
  deliveryInfo,
  shippingNote,
  productName,
  productImage,
  price,
  quantity,
  options = [],
  showInquiry = true,
  orderItems,
  variantId,
  coreActions,
  availableActions: availableActionsProp,
  cancelUnavailableReason: cancelUnavailableReasonProp,
  channelInfo: channelInfoProp,
}: OrderCardContentProps) {
  const availableActions = coreActions?.availableActions ?? availableActionsProp
  const cancelUnavailableReason = coreActions?.cancelUnavailableReason ?? cancelUnavailableReasonProp
  const channelInfo = coreActions?.channelInfo ?? channelInfoProp
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { addToCart, isLoading: isAddingToCart } = useAddToCart()
  const resolvedProductImage = getThumbnailUrl(productImage)
  const quantityText = typeof quantity === "number" ? `${quantity}개` : quantity
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [isCancelling, startCancelTransition] = useTransition()
  const [cancelReasonCode, setCancelReasonCode] = useState<CancelReasonCode>("CHANGE_OF_MIND")
  const [cancelReasonDetail, setCancelReasonDetail] = useState("")

  const canConfirmPurchase = paymentStatus === "authorized" && !isConfirmed
  // Core projection 기준 주 상태 텍스트. Core 조회 실패 시 Medusa status로 fallback.
  const displayStatus = coreActions ? getCoreDisplayStatus(coreActions) : status

  // Core 액션 목록이 있으면 그것을 기준으로, 없으면 Medusa 상태 기반 fallback
  const canCancel = availableActions ? availableActions.includes("cancel") : false
  const canTrack = availableActions ? availableActions.includes("track") : false
  const canReturn = availableActions?.includes("return") ?? false
  const canExchange = availableActions?.includes("exchange") ?? false
  const cancelTooltip = cancelUnavailableReason ? CANCEL_UNAVAILABLE_MESSAGES[cancelUnavailableReason] : undefined

  const handleConfirmPurchase = () => {
    if (!confirm("구매를 확정하시겠습니까?\n\n확정 후에는 반품·환불이 어려울 수 있어요.")) return
    startTransition(async () => {
      const result = await captureOrderPayment(orderId, orderItems)
      if (!result.success) {
        toast.error(result.message ?? "구매확정에 실패했습니다.")
        return
      }
      setIsConfirmed(true)
      toast.success("구매확정이 완료되었습니다.")
      router.refresh()
    })
  }

  const handleAddToCart = async () => {
    const result = await addToCart({ variantId })
    if (result.success) {
      toast.success("장바구니에 담았습니다.", {
        action: { label: "장바구니 보기", onClick: () => router.push("/cart") },
      })
    }
  }

  const handleCancelConfirm = () => {
    startCancelTransition(async () => {
      try {
        const result = await cancelOrderByMedusaId(orderId, {
          reasonCode: cancelReasonCode,
          reasonDetail:
            cancelReasonCode === "OTHER" && cancelReasonDetail
              ? cancelReasonDetail
              : undefined,
        })
        const message =
          result.refundStatus === "succeeded"
            ? "주문이 취소되고 환불이 완료되었습니다."
            : result.refundStatus === "pending"
              ? "주문이 취소되었습니다. 환불 처리 중입니다."
              : result.refundStatus === "failed"
                ? "주문은 취소되었지만 환불에 실패했습니다. 고객센터에서 확인해 주세요."
                : result.refundStatus === "manual_pending"
                  ? "주문은 취소되었습니다. 환불은 고객센터에서 확인 후 처리됩니다."
                  : "주문이 취소되었습니다."
        toast.success(message)
        setShowCancelDialog(false)
        router.refresh()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : undefined
        toast.error(message ?? "취소 처리 중 오류가 발생했습니다.")
      }
    })
  }

  return (
    <div className="flex flex-col rounded-[5px] border border-gray-200 bg-white px-3 py-3.5 md:flex-row md:items-center md:gap-9 md:px-5">
      <section className="flex-1 md:min-w-60">
        <div className="space-y-5">
          <div className="space-y-1.5 md:space-y-0">
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-black md:text-lg">{displayStatus}</h3>
                  {deliveryInfo && (
                    <span className="text-xs text-green-500 md:text-lg">{deliveryInfo}</span>
                  )}
                </div>
                {/* Core 상태 badge — 주문/출고/환불 분리 */}
                <OrderStatusBadges actions={coreActions} />
                {/* 취소 불가 사유 안내 */}
                {cancelUnavailableReason && !canCancel && cancelTooltip && (
                  <p className="text-[10px] text-muted-foreground">{cancelTooltip}</p>
                )}
              </div>
            </div>
            {shippingNote && (
              <p className="text-xs leading-4 font-bold text-amber-500 md:hidden">{shippingNote}</p>
            )}
          </div>

          <div className="flex items-center gap-2.5 md:gap-3.5">
            <figure className="shrink-0">
              <img className="h-20 w-16 rounded-[5px]" src={resolvedProductImage} alt={productName} />
            </figure>
            <div className="flex flex-1 flex-col gap-2">
              <h4 className="text-sm text-black md:text-base">{productName}</h4>
              <div className="flex items-end justify-between">
                <div className="min-w-28 flex-1 text-xs text-gray-500 md:text-sm">
                  <p>{price} · {quantityText}</p>
                  {options.map((option, index) => (
                    <p key={index}>- {option}</p>
                  ))}
                </div>
                <CustomButton
                  type="button"
                  className="hidden rounded-[3px] md:inline-flex"
                  onClick={handleAddToCart}
                  disabled={isAddingToCart}
                  isLoading={isAddingToCart}
                >
                  다시 담기
                </CustomButton>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="hidden h-36 w-px bg-gray-200 md:block" aria-hidden="true" />

      {/* 모바일 버튼 */}
      <div className="mt-5 flex items-center gap-2.5 md:hidden">
        {canConfirmPurchase ? (
          <CustomButton
            type="button" variant="fill" color="primary" size="lg"
            className="flex-1" fullWidth isLoading={isPending}
            onClick={handleConfirmPurchase}
          >
            구매확정
          </CustomButton>
        ) : canTrack ? (
          <LocalizedClientLink href={`/mypage/order/track?orderId=${orderId}`} className="flex-1">
            <CustomButton type="button" variant="outline" color="secondary" size="lg" fullWidth>
              배송 조회
            </CustomButton>
          </LocalizedClientLink>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white transition hover:bg-gray-50"
              aria-label="더보기"
            >
              <MoreVertical className="h-4 w-4 text-gray-600" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2"
              onClick={handleAddToCart}
              disabled={isAddingToCart}
            >
              <ShoppingCart className="h-4 w-4" />
              다시 담기
            </DropdownMenuItem>
            {canTrack && (
              <DropdownMenuItem asChild>
                <LocalizedClientLink
                  href={`/mypage/order/track?orderId=${orderId}`}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <Package className="h-4 w-4" />
                  배송 조회
                </LocalizedClientLink>
              </DropdownMenuItem>
            )}
            {canReturn && (
              <DropdownMenuItem asChild>
                <LocalizedClientLink
                  href={`/mypage/exchange?orderId=${orderId}&type=return`}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  반품 신청
                </LocalizedClientLink>
              </DropdownMenuItem>
            )}
            {canExchange && (
              <DropdownMenuItem asChild>
                <LocalizedClientLink
                  href={`/mypage/exchange?orderId=${orderId}&type=exchange`}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  교환 신청
                </LocalizedClientLink>
              </DropdownMenuItem>
            )}
            {canCancel && (
              <DropdownMenuItem
                className="flex cursor-pointer items-center gap-2 text-red-600"
                onClick={() => setShowCancelDialog(true)}
              >
                <RotateCcw className="h-4 w-4" />
                주문 취소
              </DropdownMenuItem>
            )}
            {!canCancel && channelInfo?.cancelUrl && (
              <DropdownMenuItem asChild>
                <a
                  href={channelInfo.cancelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex cursor-pointer items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  {channelInfo.channel}에서 취소
                </a>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 데스크탑 버튼 */}
      <aside className="hidden max-w-48 min-w-28 flex-1 flex-col gap-2.5 md:flex">
        {canConfirmPurchase && (
          <CustomButton variant="fill" color="primary" size="md" fullWidth isLoading={isPending} onClick={handleConfirmPurchase}>
            구매확정
          </CustomButton>
        )}
        {canTrack && (
          <LocalizedClientLink href={`/mypage/order/track?orderId=${orderId}`}>
            <CustomButton variant="outline" color="secondary" size="md" fullWidth>
              배송 조회
            </CustomButton>
          </LocalizedClientLink>
        )}
        {canReturn && (
          <LocalizedClientLink href={`/mypage/exchange?orderId=${orderId}&type=return`}>
            <CustomButton variant="outline" color="secondary" size="md" fullWidth>
              반품 신청
            </CustomButton>
          </LocalizedClientLink>
        )}
        {canExchange && (
          <LocalizedClientLink href={`/mypage/exchange?orderId=${orderId}&type=exchange`}>
            <CustomButton variant="outline" color="secondary" size="md" fullWidth>
              교환 신청
            </CustomButton>
          </LocalizedClientLink>
        )}
        {canCancel ? (
          <CustomButton
            variant="outline" color="secondary" size="md" fullWidth
            onClick={() => setShowCancelDialog(true)}
          >
            주문취소
          </CustomButton>
        ) : cancelUnavailableReason && channelInfo?.cancelUrl ? (
          <a href={channelInfo.cancelUrl} target="_blank" rel="noopener noreferrer">
            <CustomButton variant="outline" color="secondary" size="md" fullWidth>
              {channelInfo.channel}에서 취소
            </CustomButton>
          </a>
        ) : cancelUnavailableReason && cancelUnavailableReason !== 'already_cancelled' ? (
          <CustomButton variant="outline" color="secondary" size="md" fullWidth disabled title={cancelTooltip}>
            주문취소 불가
          </CustomButton>
        ) : null}
        {showInquiry && (
          <CustomButton type="button" variant="outline" color="secondary" size="md" fullWidth>
            문의
          </CustomButton>
        )}
      </aside>

      {/* 취소 확인 dialog */}
      <Dialog
        open={showCancelDialog}
        onOpenChange={(open) => {
          setShowCancelDialog(open)
          if (!open) {
            setCancelReasonCode("CHANGE_OF_MIND")
            setCancelReasonDetail("")
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>주문 취소</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-medium">{productName}</span> 주문을 취소하시겠습니까?
            </p>
            <p className="text-muted-foreground text-xs">
              취소 완료 후 결제 수단에 따라 환불이 진행됩니다.
            </p>
            <CancelReasonForm
              reasonCode={cancelReasonCode}
              reasonDetail={cancelReasonDetail}
              onReasonCodeChange={setCancelReasonCode}
              onReasonDetailChange={setCancelReasonDetail}
            />
          </div>
          <DialogFooter>
            <CustomButton variant="outline" color="secondary" size="md" onClick={() => setShowCancelDialog(false)} disabled={isCancelling}>
              돌아가기
            </CustomButton>
            <CustomButton variant="fill" color="primary" size="md" onClick={handleCancelConfirm} isLoading={isCancelling}>
              취소 확인
            </CustomButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
