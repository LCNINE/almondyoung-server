"use client"

import { useCancelFailureAlert } from "@/components/orders/cancel-failure-alert"
import {
  PRINT_PARTIAL_CANCEL_AVAILABLE,
  usePrintPartialCancelDialog,
} from "@/components/orders/print-partial-cancel-dialog"
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
  DialogDescription,
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
import { captureOrderPayment } from "@/lib/api/medusa/orders"
import {
  cancelOrderByMedusaId,
  type StoreCancelUnavailableReason,
  type StoreOrderAction,
  type StoreOrderActionsResponse,
} from "@/lib/api/orders/store-orders"
import { canConfirmPurchase } from "@/lib/orders/core-order-view"
import {
  ExternalLink,
  MoreVertical,
  Package,
  RefreshCw,
  RotateCcw,
  type LucideIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition, type ReactNode } from "react"
import { RefundRequestDialog } from "@/domains/order/details/components/refund-request-dialog"
import { toast } from "sonner"

interface OrderActionsProps {
  orderId: string
  paymentStatus: string
  productName: string
  itemCount?: number
  showInquiry?: boolean
  /** 1:1 문의 제목에 미리 채울 주문번호 */
  orderNumber?: string
  coreActions?: StoreOrderActionsResponse
  availableActions?: StoreOrderAction[]
  cancelUnavailableReason?: StoreCancelUnavailableReason
  channelInfo?: { channel: string; cancelUrl?: string; returnUrl?: string }
  bankTransferStatus?: string
  refundRequestStatus?: string
  refundIntentId?: string
  autoOpenRefund?: boolean
  autoOpenRefundMedia?: string
  refundBlocked?: boolean
  isDetails?: boolean
  hasReturns?: boolean
  trackingHref?: string
  children?: (actions: ReactNode) => ReactNode
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

export default function OrderActions({
  orderId,
  paymentStatus,
  productName,
  itemCount = 1,
  showInquiry = true,
  orderNumber,
  coreActions,
  availableActions: availableActionsProp,
  cancelUnavailableReason: cancelUnavailableReasonProp,
  channelInfo: channelInfoProp,
  bankTransferStatus,
  refundRequestStatus,
  refundIntentId,
  autoOpenRefund = false,
  autoOpenRefundMedia,
  refundBlocked = false,
  isDetails = false,
  hasReturns = false,
  trackingHref,
  children,
}: OrderActionsProps) {
  const availableActions = coreActions?.availableActions ?? availableActionsProp
  const cancelUnavailableReason =
    coreActions?.cancelUnavailableReason ?? cancelUnavailableReasonProp
  const channelInfo = coreActions?.channelInfo ?? channelInfoProp
  const tActions = useTranslations("mypage.order.actions")
  const { showCancelFailure, cancelFailureAlert } = useCancelFailureAlert()
  const { askPrintPartialCancel, printPartialCancelDialog } =
    usePrintPartialCancelDialog(() => runCancel(true))
  const router = useRouter()
  const [showRefundDialog, setShowRefundDialog] = useState(false)

  useEffect(() => {
    if (!autoOpenRefund) {
      return
    }

    if (
      autoOpenRefundMedia &&
      !window.matchMedia(autoOpenRefundMedia).matches
    ) {
      return
    }

    setShowRefundDialog(true)

    // 주소에 남겨 두면 뒤로·앞으로 가기로 돌아올 때마다 다시 열린다
    const url = new URL(window.location.href)
    url.searchParams.delete("refund")
    window.history.replaceState(window.history.state, "", url)
  }, [autoOpenRefund, autoOpenRefundMedia])

  const [isPending, startTransition] = useTransition()
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [showConfirmPurchaseDialog, setShowConfirmPurchaseDialog] =
    useState(false)
  const [isCancelling, startCancelTransition] = useTransition()
  const [cancelReasonCode, setCancelReasonCode] =
    useState<CancelReasonCode>("CHANGE_OF_MIND")
  const [cancelReasonDetail, setCancelReasonDetail] = useState("")

  const isBankTransferConfirmed = bankTransferStatus === "confirmed"
  // 입금 대기(미결제) 무통장 주문은 결제가 authorized 로 매핑되지만 아직 입금 전이라
  // 구매확정 버튼을 노출하지 않는다.
  const isBankTransferAwaitingDeposit =
    bankTransferStatus === "awaiting_deposit"

  const canConfirm = canConfirmPurchase({
    paymentStatus,
    isConfirmed,
    awaitingDeposit: isBankTransferAwaitingDeposit,
    actions: coreActions,
  })
  const hasPendingRefundRequest =
    refundRequestStatus === "REQUESTED" || refundRequestStatus === "APPROVED"

  // 반품·교환이 걸린 주문은 이미 출고된 주문이다. 데이터가 어긋나도 이중 환불이 나지 않게 취소를 막는다
  const canCancel =
    !hasReturns && (availableActions?.includes("cancel") ?? false)
  const canTrack = isDetails
    ? Boolean(trackingHref)
    : (availableActions?.includes("track") ?? false)
  const canReturn = availableActions?.includes("return") ?? false
  const canExchange = availableActions?.includes("exchange") ?? false
  const cancelTooltip = cancelUnavailableReason
    ? CANCEL_UNAVAILABLE_MESSAGES[cancelUnavailableReason]
    : undefined

  // 무통장 확정 주문의 취소는 토스 환불신청 → 관리자 수락이 필요하다(즉시 자동환불 아님).
  const showSelfCancel = canCancel && !isBankTransferConfirmed
  const showBankTransferCancelGuide = canCancel && isBankTransferConfirmed

  const handleConfirmPurchase = () => setShowConfirmPurchaseDialog(true)

  const handleConfirmPurchaseSubmit = () => {
    setShowConfirmPurchaseDialog(false)
    startTransition(async () => {
      const result = await captureOrderPayment(orderId)
      if (!result.success) {
        toast.error(result.message ?? "구매확정에 실패했습니다.")
        return
      }
      setIsConfirmed(true)
      toast.success("구매확정이 완료되었습니다.")
      router.refresh()
    })
  }

  // TODO(물류 API 연동): 실제 택배사 트래킹 화면으로 연결. 현재는 데이터 소스가 없어 안내 토스트.
  const handleTrack = () =>
    toast.info("배송 조회는 준비 중이에요. 고객센터로 문의해 주세요.")

  const handleCancelConfirm = () => runCancel(false)

  const runCancel = (excludePrint: boolean) => {
    startCancelTransition(async () => {
      try {
        const result = await cancelOrderByMedusaId(orderId, {
          reasonCode: cancelReasonCode,
          ...(excludePrint ? { excludePrint: true } : {}),
          reasonDetail:
            cancelReasonCode === "OTHER" && cancelReasonDetail
              ? cancelReasonDetail
              : undefined,
        })
        if (!result.success) {
          setShowCancelDialog(false)
          if (result.code === PRINT_PARTIAL_CANCEL_AVAILABLE) {
            askPrintPartialCancel()
            return
          }
          showCancelFailure(result.error)
          return
        }
        setShowCancelDialog(false)
        // 취소는 요청 순간 확정된다(#1016 36번 재설계 §8.2) — 응답이 곧 «취소 완료»다
        toast.success(tActions("cancelCompleted"))
        router.refresh()
      } catch (err: unknown) {
        // 인증 실패는 error.tsx 가 토큰 복구를 처리하도록 전파
        if ((err as { digest?: string }).digest === "UNAUTHORIZED") throw err
        setShowCancelDialog(false)
        showCancelFailure(tActions("cancelError"))
      }
    })
  }

  // ── 액션 단일 정의 ─────────────────────────────────────────────
  const actions: OrderAction[] = []
  if (canConfirm)
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
      ...(trackingHref ? { href: trackingHref } : { onClick: handleTrack }),
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
      label: "주문 취소",
      icon: RotateCcw,
      danger: true,
      onClick: () => setShowCancelDialog(true),
    })
  else if (showBankTransferCancelGuide && hasPendingRefundRequest)
    actions.push({
      key: "refundRequested",
      label: refundRequestStatus === "APPROVED" ? "환불 완료" : "환불 신청됨",
      icon: RotateCcw,
      disabled: true,
    })
  else if (showBankTransferCancelGuide)
    actions.push({
      key: "refundRequest",
      label: "주문 취소",
      icon: RotateCcw,
      disabled: refundBlocked || (isDetails && !refundIntentId),
      ...(isDetails
        ? { onClick: () => setShowRefundDialog(true) }
        : {
            href: `/mypage/order/details?orderId=${encodeURIComponent(orderId)}&refund=1`,
          }),
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
    cancelUnavailableReason !== "already_cancelled" &&
    !canReturn
  )
    actions.push({
      key: "cancelUnavailable",
      label: "주문취소 불가",
      disabled: true,
    })
  if (showInquiry) {
    actions.push({
      key: "inquiry",
      label: "1:1 문의",
      href: orderNumber
        ? `/cs?tab=inquiry&orderNumber=${encodeURIComponent(orderNumber)}`
        : "/cs?tab=inquiry",
    })
  }

  // 모바일은 주요 버튼 하나와 더보기 메뉴로 나눈다.
  const primaryKey = canConfirm
    ? "confirm"
    : canTrack
      ? "track"
      : showSelfCancel
        ? "cancel"
        : showBankTransferCancelGuide
          ? hasPendingRefundRequest
            ? "refundRequested"
            : "refundRequest"
          : null
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
        className={action.primary ? undefined : "active:bg-secondary"}
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

  const controls = (
    <>
      {actions.length > 0 && (
        <div className="hidden flex-col gap-2 md:flex">
          {actions.map((action) => (
            <div key={action.key}>{renderButton(action, "md")}</div>
          ))}
        </div>
      )}

      {/* 모바일: 주요 버튼 + 더보기 메뉴 */}
      <div className="flex items-center gap-2 md:hidden">
        {primaryAction ? (
          <div className="flex-1">{renderButton(primaryAction, "md")}</div>
        ) : (
          <LocalizedClientLink
            href={`/mypage/order/details?orderId=${orderId}`}
            className="flex-1"
          >
            <CustomButton
              type="button"
              variant="outline"
              color="secondary"
              size="md"
              fullWidth
            >
              배송·주문 관리
            </CustomButton>
          </LocalizedClientLink>
        )}

        {menuActions.length > 0 && (
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
        )}
      </div>

      {isDetails &&
        cancelTooltip &&
        cancelUnavailableReason !== "already_cancelled" && (
          <p className="text-xs text-red-600">{cancelTooltip}</p>
        )}
      {showBankTransferCancelGuide && isDetails && refundBlocked && (
        <p className="text-muted-foreground text-xs">
          이미 다운로드한 상품이 있어 취소할 수 없어요. 고객센터로 문의해
          주세요.
        </p>
      )}
    </>
  )

  return (
    <>
      {children ? children(controls) : controls}
      {showBankTransferCancelGuide &&
        refundIntentId &&
        !hasPendingRefundRequest &&
        !refundBlocked && (
          <RefundRequestDialog
            intentId={refundIntentId}
            open={showRefundDialog}
            onOpenChange={setShowRefundDialog}
          />
        )}

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
            <DialogDescription className="text-xs">
              확정 후에는 반품·교환 가능 조건이 달라질 수 있어요.
            </DialogDescription>
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
            <DialogTitle>주문을 취소할까요?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="font-medium">{productName}</p>
            {itemCount > 1 && (
              <p>이 주문의 상품 {itemCount}개가 함께 취소돼요.</p>
            )}
            <DialogDescription className="text-xs">
              취소 완료 후 결제 수단에 따라 환불이 진행돼요.
            </DialogDescription>
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
      {cancelFailureAlert}
      {printPartialCancelDialog}
    </>
  )
}
