import React from "react"
import DeliveryStepper from "./delivery-stepper"
import { DynamicDeliveryContent } from "./delivery-status-content"

// ============================================
// Types
// ============================================

interface DeliveryHeaderWithChildrenProps {
  children: React.ReactNode
  currentStep?: never
  completedDate?: never
}

interface DeliveryHeaderWithStepProps {
  currentStep: number
  completedDate?: string
  children?: never
}

type DeliveryHeaderProps =
  | DeliveryHeaderWithChildrenProps
  | DeliveryHeaderWithStepProps

// ============================================
// Main Component
// ============================================

export default function DeliveryHeader({
  children,
  currentStep,
  completedDate,
}: DeliveryHeaderProps) {
  return (
    <section className="flex flex-col items-center justify-start gap-5 self-stretch bg-[#3b4156] p-[30px] md:rounded-lg">
      {children ? (
        children
      ) : currentStep !== undefined ? (
        <>
          <DynamicDeliveryContent
            currentStep={currentStep}
            completedDate={completedDate}
          />
          <DeliveryStepper currentStep={currentStep} />
        </>
      ) : null}
    </section>
  )
}
