"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAddToCart } from "@/hooks/api/use-add-to-cart"
import { captureOrderPayment } from "@/lib/api/medusa/orders"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { MoreVertical, Package, RotateCcw, ShoppingCart } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

interface OrderCardContentProps {
  /** 주문 ID */
  orderId: string
  /** 주문 상태 (예: "배송 완료") */
  status: string
  /** 결제 상태 (예: "authorized", "captured") */
  paymentStatus: string
  /** 배송 관련 추가 정보 (예: "6/18(화) 도착") */
  deliveryInfo?: string
  /** 배송 참고 사항 (모바일 전용) */
  shippingNote?: string
  /** 상품명 */
  productName: string
  /** 상품 이미지 URL */
  productImage: string
  /** 가격 (포맷된 문자열) */
  price: string
  /** 수량 */
  quantity: number | string
  /** 상품 옵션 배열 */
  options?: string[]
  /** 문의 버튼 표시 여부 (데스크탑 전용) */
  showInquiry?: boolean
  /** 주문 아이템 목록 (구매 확정 시 리뷰 자격 생성용) */
  orderItems?: Array<{ productId: string; orderLineId: string }>
  /** 상품 variant ID (장바구니 담기용) */
  variantId: string
}

/**
 * 주문 카드의 메인 콘텐츠 컴포넌트
 * 상품 정보, 상태, 액션 버튼 등을 포함합니다.
 */
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
}: OrderCardContentProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { addToCart, isLoading: isAddingToCart } = useAddToCart()
  const resolvedProductImage = getThumbnailUrl(productImage)
  const quantityText = typeof quantity === "number" ? `${quantity}개` : quantity
  const [isConfirmed, setIsConfirmed] = useState(false)
  const canConfirmPurchase = paymentStatus === "authorized" && !isConfirmed

  const handleConfirmPurchase = () => {
    if (
      !confirm(
        "구매를 확정하시겠습니까?\n\n확정 후에는 반품·환불이 어려울 수 있어요."
      )
    )
      return

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
        action: {
          label: "장바구니 보기",
          onClick: () => router.push("/cart"),
        },
      })
    }
  }

  return (
    <div className="flex flex-col rounded-[5px] border border-gray-200 bg-white px-3 py-3.5 md:flex-row md:items-center md:gap-9 md:px-5">
      <section className="flex-1 md:min-w-60">
        <div className="space-y-5">
          <div className="space-y-1.5 md:space-y-0">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-bold text-black md:text-lg">
                  {status}
                </h3>
                {deliveryInfo && (
                  <span className="text-xs text-green-500 md:text-lg">
                    {deliveryInfo}
                  </span>
                )}
              </div>
            </div>

            {/* 모바일 전용 - 배송 노트 */}
            {shippingNote && (
              <p className="text-xs leading-4 font-bold text-amber-500 md:hidden">
                {shippingNote}
              </p>
            )}
          </div>

          {/* 상품 카드 - container 추후 map함수로 렌러링해도됨.*/}
          <div className="flex items-center gap-2.5 md:gap-3.5">
            {/* 상품 이미지 */}
            <figure className="shrink-0">
              <img
                className="h-20 w-16 rounded-[5px]"
                src={resolvedProductImage}
                alt={productName}
              />
            </figure>

            <div className="flex flex-1 flex-col gap-2">
              {/* 상품명 */}
              <h4 className="text-sm text-black md:text-base">{productName}</h4>

              <div className="flex items-end justify-between">
                <div className="min-w-28 flex-1 text-xs text-gray-500 md:text-sm">
                  <p>
                    {price} · {quantityText}
                  </p>
                  {options.map((option, index) => (
                    <p key={index}>- {option}</p>
                  ))}
                </div>

                {/* 장바구니 버튼 - 데스크탑만 */}
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

      {/* 데스크탑 전용 - 구분선 */}
      <div
        className="hidden h-36 w-px bg-gray-200 md:block"
        aria-hidden="true"
      />

      {/* 모바일 버튼: 주요 액션 + 더보기 메뉴 */}
      <div className="mt-5 flex items-center gap-2.5 md:hidden">
        {canConfirmPurchase ? (
          <CustomButton
            type="button"
            variant="fill"
            color="primary"
            size="lg"
            className="flex-1"
            fullWidth={true}
            isLoading={isPending}
            onClick={handleConfirmPurchase}
          >
            구매확정
          </CustomButton>
        ) : (
          <LocalizedClientLink
            href={`/mypage/order/track?orderId=${orderId}`}
            className="flex-1"
          >
            <CustomButton
              type="button"
              variant="outline"
              color="secondary"
              size="lg"
              fullWidth={true}
            >
              배송 조회
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
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2"
              onClick={handleAddToCart}
              disabled={isAddingToCart}
            >
              <ShoppingCart className="h-4 w-4" />
              다시 담기
            </DropdownMenuItem>
            {canConfirmPurchase && (
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
            <DropdownMenuItem className="flex cursor-pointer items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              취소 / 반품 신청
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 데스크탑 버튼 (3개 세로) */}
      <aside className="hidden max-w-48 min-w-28 flex-1 flex-col gap-2.5 md:flex">
        {canConfirmPurchase && (
          <CustomButton
            variant="fill"
            color="primary"
            size="md"
            fullWidth={true}
            isLoading={isPending}
            onClick={handleConfirmPurchase}
          >
            구매확정
          </CustomButton>
        )}
        <LocalizedClientLink href={`/mypage/order/track?orderId=${orderId}`}>
          <CustomButton
            variant="outline"
            color="secondary"
            size="md"
            fullWidth={true}
          >
            배송 조회
          </CustomButton>
        </LocalizedClientLink>
        <CustomButton
          variant="outline"
          color="secondary"
          size="md"
          fullWidth={true}
        >
          주문취소
        </CustomButton>
        {showInquiry && (
          <CustomButton
            type="button"
            variant="outline"
            color="secondary"
            size="md"
            fullWidth={true}
          >
            문의
          </CustomButton>
        )}
      </aside>
    </div>
  )
}
