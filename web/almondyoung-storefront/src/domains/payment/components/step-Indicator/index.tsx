"use client"

interface Step {
  id: string
  label: string
}

/**
 * 검증 스텝 인디케이터 컴포넌트
 * Ex) 1. 본인 인증 -> 2. 사업자 확인 -> 3. 계좌등록 및 동의
 */
export function StepIndicator({
  steps,
  currentStep,
  isSecurityPage,
}: {
  steps: readonly Step[]
  currentStep: string
  isSecurityPage: boolean
}) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep)

  if (currentStep === "bankAccount" || isSecurityPage) {
    return null
  }

  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center gap-2">
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${
              index <= currentIndex
                ? "bg-amber-500 text-white"
                : "bg-gray-200 text-gray-500"
            } `}
          >
            {index + 1}
          </div>
          <span
            className={`text-sm ${
              index <= currentIndex ? "text-gray-900" : "text-gray-400"
            }`}
          >
            {step.label}
          </span>
          {index < steps.length - 1 && <div className="h-px w-8 bg-gray-300" />}
        </div>
      ))}
    </div>
  )
}
