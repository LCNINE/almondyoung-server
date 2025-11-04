"use client"

import { CustomButton } from "@components/common/custom-buttons/custom-button"

import type { OrderStatus } from "@components/orders/types"

interface OrderActionButtonsProps {
  type: OrderStatus
}

/**
 * 버튼을 렌더링하는 내부 헬퍼 컴포넌트입니다.
 * type에 따라 버튼 목록을 반환합니다.
 */
function ActionButtonsList({ type }: OrderActionButtonsProps) {
  const handleTrackingClick = () => console.log("배송 조회")
  const handleCancelClick = () => console.log("주문 취소")
  const handleExchangeClick = () => console.log("교환, 반품 신청")
  const handleInquiryClick = () => console.log("문의")

  // [핵심] 모바일에서는 flex-1, 데스크톱에서는 w-full로 동작하는 공통 props
  const commonButtonProps = {
    className: "flex-1 md:flex-none md:w-full",
  }

  if (type === "preparing") {
    return (
      <>
        <CustomButton
          variant="outline"
          size="lg"
          onClick={handleTrackingClick}
          {...commonButtonProps}
        >
          배송 조회
        </CustomButton>
        <CustomButton
          variant="secondary"
          size="lg"
          onClick={handleCancelClick}
          {...commonButtonProps}
        >
          주문취소
        </CustomButton>
        <CustomButton
          variant="secondary"
          size="lg"
          onClick={handleInquiryClick}
          {...commonButtonProps}
        >
          문의
        </CustomButton>
      </>
    )
  }

  if (type === "completed") {
    return (
      <>
        <CustomButton
          variant="outline"
          size="lg"
          onClick={handleTrackingClick}
          {...commonButtonProps}
        >
          배송 조회
        </CustomButton>
        <CustomButton
          variant="secondary"
          size="lg"
          onClick={handleExchangeClick}
          {...commonButtonProps}
        >
          교환, 반품 신청
        </CustomButton>
      </>
    )
  }

  if (type === "cancelled") {
    return (
      <CustomButton
        variant="ghost"
        color="secondary"
        size="lg"
        onClick={handleInquiryClick}
        {...commonButtonProps}
      >
        문의
      </CustomButton>
    )
  }

  // shipping (default)
  return (
    <>
      <CustomButton
        variant="outline"
        size="lg"
        onClick={handleTrackingClick}
        {...commonButtonProps}
      >
        배송 조회
      </CustomButton>
      <CustomButton
        variant="secondary"
        size="lg"
        onClick={handleExchangeClick}
        {...commonButtonProps}
      >
        교환, 반품 신청
      </CustomButton>
      <CustomButton
        variant="secondary" 
        size="lg"
        onClick={handleInquiryClick}
        {...commonButtonProps}
      >
        문의
      </CustomButton>
    </>
  )
}

/**
 * 메인 버튼 컨테이너 컴포넌트
 * (코드 중복 제거 및 모바일/데스크톱 반응형 처리)
 */
export function OrderActionButtons({ type }: OrderActionButtonsProps) {
  return (
    // [수정 없음] 요청하신 모바일-퍼스트, flex-row(기본) / md:flex-col(데스크톱) 구조
    <div className="flex flex-1 gap-2 md:flex-col">
      <ActionButtonsList type={type} />
    </div>
  )
}
