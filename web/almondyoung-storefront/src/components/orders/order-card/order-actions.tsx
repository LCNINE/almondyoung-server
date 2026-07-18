"use client"

import {
  CancelReasonForm,
  type CancelReasonCode,
} from "@/components/orders/cancel-reason-form"
import { CANCEL_UNAVAILABLE_MESSAGES } from "@/components/orders/order-status-badges"
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
import {
  cancelOrderByMedusaId,
  type StoreCancelUnavailableReason,
  type StoreOrderAction,
  type StoreOrderActionsResponse,
} from "@/lib/api/orders/store-orders"
import {
  ExternalLink,
  MoreVertical,
  Package,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

interface OrderActionsProps {
  orderId: string
  paymentStatus: string
  productName: string
  variantId: string
  showInquiry?: boolean
  orderItems?: Array<{ productId: string; orderLineId: string }>
  coreActions?: StoreOrderActionsResponse
  availableActions?: StoreOrderAction[]
  cancelUnavailableReason?: StoreCancelUnavailableReason
  channelInfo?: { channel: string; cancelUrl?: string; returnUrl?: string }
  bankTransferStatus?: string
  refundRequestStatus?: string
}

/**
 * 주문 카드 액션의 단일 정의.
 * 데스크탑(세로 버튼)·모바일(주요 버튼 + 더보기)이 모두 이 배열을 렌더하므로,
 * 동작을 바꿀 때 한 곳만 수정하면 양쪽에 반영된다(모바일/데스크탑 중복 방지).
 */
interface OrderAction {
  key: string
  label: string
  icon?: LucideIcon
  /** true 면 강조(fill/primary) 버튼 */
  primary?: boolean
  /** true 면 더보기 메뉴에서 빨간색(파괴적 동작) */
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
  href?: string
  /** 외부 링크(새 탭) */
  external?: boolean
}

/**
 * 주문 카드의 액션 버튼 영역 — OrderSummaryCard 의 children 으로 주입.
 */
export default function OrderActions({
  orderId,
  paymentStatus,
  productName,
  variantId,
  showInquiry = true,
  orderItems,
  coreActions,
  availableActions: availableActionsProp,
  cancelUnavailableReason: cancelUnavailableReasonProp,
  channelInfo: channelInfoProp,
  bankTransferStatus,
  refundRequestStatus,
}: OrderActionsProps) {
  const availableActions = coreActions?.availableActions ?? availableActionsProp
  const cancelUnavailableReason =
    coreActions?.cancelUnavailableReason ?? cancelUnavailableReasonProp
  const channelInfo = coreActions?.channelInfo ?? channelInfoProp
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { addToCart, isLoading: isAddingToCart } = useAddToCart()
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [showConfirmPurchaseDialog, setShowConfirmPurchaseDialog] =
    useState(false)
  const [isCancelling, startCancelTransition] = useTransition()
  const [cancelReasonCode, setCancelReasonCode] =
    useState<CancelReasonCode>("CHANGE_OF_MIND")
  const [cancelReasonDetail, setCancelReasonDetail] = useState("")

  // 무통장입금 주문 식별 (#439 마커)
  const isBankTransferConfirmed = bankTransferStatus === "confirmed"
  // 입금 대기(미결제) 무통장 주문은 결제가 authorized 로 매핑되지만 아직 입금 전이라
  // 구매확정 버튼을 노출하지 않는다.
  const isBankTransferAwaitingDeposit =
    bankTransferStatus === "awaiting_deposit"

  const canConfirmPurchase =
    paymentStatus === "authorized" &&
    !isConfirmed &&
    !isBankTransferAwaitingDeposit
  const hasPendingRefundRequest = refundRequestStatus === "REQUESTED"

  const canCancel = availableActions
    ? availableActions.includes("cancel")
    : false
  const canTrack = availableActions ? availableActions.includes("track") : false
  const canReturn = availableActions?.includes("return") ?? false
  const canExchange = availableActions?.includes("exchange") ?? false
  const cancelTooltip = cancelUnavailableReason
    ? CANCEL_UNAVAILABLE_MESSAGES[cancelUnavailableReason]
    : undefined

  // 무통장 확정 주문의 취소는 토스 환불신청 → 관리자 수락이 필요하다(즉시 자동환불 아님).
  // 셀프 취소 버튼 대신 '환불 신청'(주문 상세에서 신청)으로 안내한다.
  const showSelfCancel = canCancel && !isBankTransferConfirmed
  const showBankTransferCancelGuide = canCancel && isBankTransferConfirmed

  const handleConfirmPurchase = () => setShowConfirmPurchaseDialog(true)

  const handleConfirmPurchaseSubmit = () => {
    setShowConfirmPurchaseDialog(false)
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

  // TODO(물류 API 연동): 실제 택배사 트래킹 화면으로 연결. 현재는 데이터 소스가 없어 안내 토스트.
  const handleTrack = () =>
    toast.info("배송 조회는 준비 중이에요. 고객센터로 문의해 주세요.")

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

  // ── 액션 단일 정의 ─────────────────────────────────────────────
  const actions: OrderAction[] = [
    {
      key: "addToCart",
      label: "장바구니 담기",
      icon: ShoppingCart,
      onClick: handleAddToCart,
      disabled: isAddingToCart,
    },
  ]
  if (canConfirmPurchase)
    actions.push({
      key: "confirm",
      label: "구매확정",
      primary: true,
      onClick: handleConfirmPurchase,
    })
  if (canTrack)
    actions.push({
      key: "track",
      label: "배송 조회",
      icon: Package,
      onClick: handleTrack,
    })
  if (canReturn)
    actions.push({
      key: "return",
      label: "반품 신청",
      icon: RotateCcw,
      href: `/mypage/exchange?orderId=${orderId}&type=return`,
    })
  if (canExchange)
    actions.push({
      key: "exchange",
      label: "교환 신청",
      icon: RefreshCw,
      href: `/mypage/exchange?orderId=${orderId}&type=exchange`,
    })
  if (showSelfCancel)
    actions.push({
      key: "cancel",
      label: "주문취소",
      icon: RotateCcw,
      danger: true,
      onClick: () => setShowCancelDialog(true),
    })
  else if (showBankTransferCancelGuide && hasPendingRefundRequest)
    actions.push({
      key: "refundRequested",
      label: "환불 신청됨",
      icon: RotateCcw,
      disabled: true,
    })
  else if (showBankTransferCancelGuide)
    actions.push({
      key: "refundRequest",
      label: "환불 신청",
      icon: RotateCcw,
      href: `/mypage/order/details?orderId=${orderId}`,
    })
  else if (cancelUnavailableReason && channelInfo?.cancelUrl)
    actions.push({
      key: "channelCancel",
      label: `${channelInfo.channel}에서 취소`,
      icon: ExternalLink,
      href: channelInfo.cancelUrl,
      external: true,
    })
  else if (
    cancelUnavailableReason &&
    cancelUnavailableReason !== "already_cancelled"
  )
    actions.push({
      key: "cancelUnavailable",
      label: "주문취소 불가",
      disabled: true,
    })
  if (showInquiry) actions.push({ key: "inquiry", label: "문의" })

  // 모바일 주요 버튼: 구매확정 > 배송조회, 둘 다 없으면 주문 상세 이동.
  const primaryKey = canConfirmPurchase ? "confirm" : canTrack ? "track" : null
  const primaryAction = actions.find((a) => a.key === primaryKey)
  const menuActions = actions.filter((a) => a.key !== primaryKey)

  const renderButton = (action: OrderAction, size: "md" | "lg") => {
    const button = (
      <CustomButton
        type="button"
        variant={action.primary ? "fill" : "outline"}
        color={action.primary ? "primary" : "secondary"}
        size={size}
        fullWidth
        disabled={action.disabled}
        isLoading={action.key === "confirm" ? isPending : undefined}
        onClick={action.onClick}
        title={action.key === "cancelUnavailable" ? cancelTooltip : undefined}
      >
        {action.label}
      </CustomButton>
    )
    if (action.href && action.external)
      return (
        <a href={action.href} target="_blank" rel="noopener noreferrer">
          {button}
        </a>
      )
    if (action.href)
      return <LocalizedClientLink href={action.href}>{button}</LocalizedClientLink>
    return button
  }

  const renderMenuItem = (action: OrderAction) => {
    const inner = (
      <>
        {action.icon && <action.icon className="h-4 w-4" />}
        {action.label}
      </>
    )
    const className = `flex items-center gap-2 ${action.disabled ? "" : "cursor-pointer"} ${action.danger ? "text-red-600" : ""}`
    if (action.href && action.external)
      return (
        <DropdownMenuItem key={action.key} asChild>
          <a
            href={action.href}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
          >
            {inner}
          </a>
        </DropdownMenuItem>
      )
    if (action.href)
      return (
        <DropdownMenuItem key={action.key} asChild>
          <LocalizedClientLink href={action.href} className={className}>
            {inner}
          </LocalizedClientLink>
        </DropdownMenuItem>
      )
    return (
      <DropdownMenuItem
        key={action.key}
        className={className}
        disabled={action.disabled}
        onClick={action.onClick}
      >
        {inner}
      </DropdownMenuItem>
    )
  }

  return (
    <>
      {/* 데스크탑: 세로 버튼 나열 */}
      <div className="hidden flex-col gap-2 md:flex">
        {actions.map((action) => (
          <div key={action.key}>{renderButton(action, "md")}</div>
        ))}
      </div>

      {/* 모바일: 주요 버튼 + 더보기 메뉴 */}
      <div className="flex items-center gap-2 md:hidden">
        {primaryAction ? (
          <div className="flex-1">{renderButton(primaryAction, "lg")}</div>
        ) : (
          <LocalizedClientLink
            href={`/mypage/order/details?orderId=${orderId}`}
            className="flex-1"
          >
            <CustomButton
              type="button"
              variant="outline"
              color="secondary"
              size="lg"
              fullWidth
            >
              배송·주문 관리
            </CustomButton>
          </LocalizedClientLink>
        )}

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
            {menuActions.map(renderMenuItem)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 구매확정 확인 dialog */}
      <Dialog
        open={showConfirmPurchaseDialog}
        onOpenChange={setShowConfirmPurchaseDialog}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>구매확정</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>구매를 확정할까요?</p>
            <p className="text-muted-foreground text-xs">
              확정 후에는 반품·교환 가능 조건이 달라질 수 있어요.
            </p>
          </div>
          <DialogFooter>
            <CustomButton
              variant="outline"
              color="secondary"
              size="md"
              onClick={() => setShowConfirmPurchaseDialog(false)}
              disabled={isPending}
            >
              취소
            </CustomButton>
            <CustomButton
              variant="fill"
              color="primary"
              size="md"
              onClick={handleConfirmPurchaseSubmit}
              isLoading={isPending}
            >
              구매확정
            </CustomButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <span className="font-medium">{productName}</span> 주문을
              취소하시겠습니까?
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
            <CustomButton
              variant="outline"
              color="secondary"
              size="md"
              onClick={() => setShowCancelDialog(false)}
              disabled={isCancelling}
            >
              돌아가기
            </CustomButton>
            <CustomButton
              variant="fill"
              color="primary"
              size="md"
              onClick={handleCancelConfirm}
              isLoading={isCancelling}
            >
              취소 확인
            </CustomButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
