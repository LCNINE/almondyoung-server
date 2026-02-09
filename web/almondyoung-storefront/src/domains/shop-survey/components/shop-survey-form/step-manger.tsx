import { StepOne } from "./step-one"
import { StepTwo } from "./step-two"

interface StepsManagerProps {
  currentStep: number
  onNextStep: () => void
}

export default function StepsManager({
  currentStep,
  onNextStep,
}: StepsManagerProps) {
  switch (currentStep) {
    case 0:
      return <StepOne onNextStep={onNextStep} />
    case 1:
      return <StepTwo />
    default:
      return <StepOne onNextStep={onNextStep} />
  }
}
