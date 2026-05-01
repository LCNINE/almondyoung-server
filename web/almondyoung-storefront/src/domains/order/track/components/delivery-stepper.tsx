import React from "react"
import { Check, Package, Flag, Truck, MapPin } from "lucide-react"
import type { LucideIcon } from "lucide-react"

// ============================================
// Types
// ============================================

type StepStatus = "completed" | "current" | "upcoming"

interface DeliveryStep {
  id: number
  label: string
  icon: LucideIcon
}

interface DeliveryStepperProps {
  currentStep: number
}

// ============================================
// Line Components
// ============================================

const CompletedLine = () => (
  <svg
    width="100%"
    height={4}
    viewBox="0 0 40 4"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="none"
  >
    <line y1={2} x2={40} y2={2} stroke="#FFA500" strokeWidth={4} />
  </svg>
)

const ActiveLine = () => (
  <svg
    width="100%"
    height={4}
    viewBox="0 0 32 4"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="none"
  >
    <line
      y1={2}
      x2="31.8178"
      y2={2}
      stroke="#FFA500"
      strokeWidth={4}
      strokeDasharray="4 4"
    />
  </svg>
)

const InactiveLine = () => (
  <svg
    width="100%"
    height={4}
    viewBox="0 0 32 4"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="none"
  >
    <line
      y1={2}
      x2="31.8178"
      y2={2}
      stroke="#D9D9D9"
      strokeWidth={4}
      strokeDasharray="4 4"
    />
  </svg>
)

// ============================================
// Helper Functions
// ============================================

const getStepStatus = (stepId: number, currentStep: number): StepStatus => {
  if (stepId < currentStep) return "completed"
  if (stepId === currentStep) return "current"
  return "upcoming"
}

const getLineComponent = (fromStepId: number, currentStep: number) => {
  // 현재 단계 이전의 모든 라인: 완료 (실선 오렌지)
  if (fromStepId < currentStep) return <CompletedLine />
  // 현재 단계로 가는 라인: 진행중 (점선 오렌지)
  if (fromStepId === currentStep) return <ActiveLine />
  // 나머지: 미진행 (점선 회색)
  return <InactiveLine />
}

// ============================================
// Step Item Component
// ============================================

interface StepItemProps {
  step: DeliveryStep
  status: StepStatus
}

const StepItem = ({ step, status }: StepItemProps) => {
  const Icon = step.icon
  const isCompleted = status === "completed"
  const isActive = status === "completed" || status === "current"

  return (
    <div className="flex w-8 shrink-0 flex-col items-center gap-2">
      {/* Icon */}
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-md ${
          isActive ? "bg-[#ffa500] text-white" : "bg-[#d9d9d9] text-[#b2b2b2]"
        }`}
      >
        {isCompleted ? (
          <Check className="h-5 w-5" />
        ) : (
          <Icon className="h-5 w-5" />
        )}
      </div>

      {/* Label */}
      <p className="text-center text-xs leading-tight font-medium break-keep text-[#b3b3b3]">
        {step.label}
      </p>
    </div>
  )
}

// ============================================
// Line Connector Component
// ============================================

interface LineConnectorProps {
  fromStepId: number
  currentStep: number
}

const LineConnector = ({ fromStepId, currentStep }: LineConnectorProps) => (
  <div className="pt-3">{getLineComponent(fromStepId, currentStep)}</div>
)

// ============================================
// Main Component
// ============================================

export default function DeliveryStepper({
  currentStep = 1,
}: DeliveryStepperProps) {
  const steps: DeliveryStep[] = [
    {
      id: 1,
      label: "결제완료",
      icon: Check,
    },
    {
      id: 2,
      label: "상품 준비중",
      icon: Package,
    },
    {
      id: 3,
      label: "배송시작",
      icon: Flag,
    },
    {
      id: 4,
      label: "배송중",
      icon: Truck,
    },
    {
      id: 5,
      label: "배송완료",
      icon: MapPin,
    },
  ]

  return (
    <div className="flex justify-center">
      {steps.map((step, index) => {
        const status = getStepStatus(step.id, currentStep)
        const isLast = index === steps.length - 1

        return (
          <React.Fragment key={step.id}>
            <StepItem step={step} status={status} />

            {!isLast && (
              <LineConnector fromStepId={step.id} currentStep={currentStep} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
