"use client"

import Link from "next/link"
import { CustomButton } from "@/components/shared/custom-buttons"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { MoreVertical } from "lucide-react"
import { captureOrderPayment } from "@/lib/api/medusa/orders"
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
}: OrderCardContentProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const resolvedProductImage = getThumbnailUrl(productImage)
  const quantityText =
    typeof quantity === "number" ? `${quantity}개` : quantity
  const [isConfirmed, setIsConfirmed] = useState(false)
  const canConfirmPurchase = paymentStatus === "authorized" && !isConfirmed

  const handleConfirmPurchase = () => {
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

  return (
    <div className="flex flex-col rounded-[5px] border border-gray-200 bg-white px-3 py-3.5 md:flex-row md:items-center md:gap-9 md:px-5">
      {/* 좌측: 상품 정보 영역 - container */}
      <section className="flex-1 md:min-w-60">
        {/* inner: 컨텐츠 그룹 */}
        <div className="space-y-5">
          {/* 상태 정보 - inner */}
          <div className="space-y-1.5 md:space-y-0">
            {/* 상태 헤더 - container */}
            <div className="flex items-start justify-between">
              {/* inner: 상태 그룹 */}
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

              {/* 더보기 버튼 */}
              <button type="button" className="h-5 w-5" aria-label="더보기">
                <MoreVertical className="h-5 w-5" />
              </button>
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

            {/* 상품 상세 - container */}
            <div className="flex flex-1 flex-col gap-2">
              {/* 상품명 */}
              <h4 className="text-sm text-black md:text-base">{productName}</h4>

              {/* 하단 정보 - container */}
              <div className="flex items-end justify-between">
                {/* 가격/옵션 정보 - inner */}
                <div className="min-w-28 flex-1 text-xs text-gray-500 md:text-sm">
                  <p>
                    {price} · {quantityText}
                  </p>
                  {options.map((option, index) => (
                    <p key={index}>- {option}</p>
                  ))}
                </div>

                {/* 장바구니 버튼 */}
                <button
                  type="button"
                  className="line-clamp-1 h-7 rounded-[3px] border border-zinc-400 bg-white px-2.5 text-xs text-gray-900 md:h-9 md:rounded-[5px] md:px-4 md:py-2.5"
                >
                  장바구니 담기
                </button>
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

      {/* 우측: 액션 버튼 영역 - 조건부 렌더링 */}
      {/* 모바일 버튼 (2개 가로) */}
      <div className="mt-5 flex items-center gap-2.5 md:hidden">
        {canConfirmPurchase && (
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
        )}
        <CustomButton
          type="button"
          variant="outline"
          color="secondary"
          size="lg"
          className="flex-1"
          fullWidth={true}
        >
          주문 취소 / 반품 신청
        </CustomButton>
        <Link
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
        </Link>
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
        <Link href={`/mypage/order/track?orderId=${orderId}`}>
          <CustomButton
            variant="outline"
            color="secondary"
            size="md"
            fullWidth={true}
          >
            배송 조회
          </CustomButton>
        </Link>
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
