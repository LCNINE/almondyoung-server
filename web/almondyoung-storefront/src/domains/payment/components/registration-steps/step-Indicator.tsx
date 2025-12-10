"use client"

interface Step {
  id: string
  label: string
}

export function StepIndicator({
  steps,
  currentStep,
}: {
  steps: readonly Step[]
  currentStep: string
}) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep)

  if (currentStep === "birthDate" || currentStep === "paymentAccount") {
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
