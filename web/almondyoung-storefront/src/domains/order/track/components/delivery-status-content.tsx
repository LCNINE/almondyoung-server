import React from "react"

// ============================================
// Types
// ============================================

interface DeliveryStatusContentProps {
  title: string
  description?: string
}

// ============================================
// Main Component
// ============================================

export function DeliveryStatusContent({
  title,
  description,
}: DeliveryStatusContentProps) {
  return (
    <>
      <p className="w-full flex-shrink-0 flex-grow-0 self-stretch text-center text-2xl font-bold text-white">
        {title}
      </p>
      {description && (
        <p className="flex-shrink-0 flex-grow-0 text-center text-lg text-white">
          {description}
        </p>
      )}
    </>
  )
}

// ============================================
// Preset Components
// ============================================

export function DeliveryCompletedContent({ date }: { date: string }) {
  return (
    <DeliveryStatusContent
      title={`${date} 도착완료`}
      description="고객님이 주문하신 상품이 배송완료 되었습니다."
    />
  )
}

export function PreparingOrderContent() {
  return <DeliveryStatusContent title="상품 준비중! 오늘 출고" />
}

export function ShippingStartedContent() {
  return (
    <DeliveryStatusContent
      title="배송이 시작되었습니다!"
      description="상품이 고객님께 전달되는 중입니다."
    />
  )
}

export function InTransitContent() {
  return (
    <DeliveryStatusContent
      title="배송중입니다"
      description="곧 도착 예정입니다."
    />
  )
}

// ============================================
// Dynamic Content by Step
// ============================================

interface DynamicDeliveryContentProps {
  currentStep: number
  completedDate?: string // 배송 완료일 (예: "8/20(수)")
}

export function DynamicDeliveryContent({
  currentStep,
  completedDate,
}: DynamicDeliveryContentProps) {
  switch (currentStep) {
    case 1:
      return <DeliveryStatusContent title="결제가 완료되었습니다" />
    case 2:
      return <PreparingOrderContent />
    case 3:
      return <ShippingStartedContent />
    case 4:
      return <InTransitContent />
    case 5:
      return completedDate ? (
        <DeliveryCompletedContent date={completedDate} />
      ) : (
        <DeliveryStatusContent
          title="배송완료"
          description="고객님이 주문하신 상품이 배송완료 되었습니다."
        />
      )
    default:
      return (
        <DeliveryStatusContent
          title="주문 처리중"
          description="주문을 처리하고 있습니다."
        />
      )
  }
}
