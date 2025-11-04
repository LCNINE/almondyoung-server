import { useShopSurvey } from "@components/shop-survey/hooks/use-shop-survey"
import { useFormContext } from "react-hook-form"
import { StepOne } from "./step-one"
import { StepTwoForm } from "./step-two/with-form"
import { CustomButton } from "@components/common/custom-buttons/custom-button"

/**
 * 샵 설문조사 Step Manager
 *
 * 책임:
 * - Step1과 Step2를 현재 단계에 따라 렌더링
 * - Step2에서 제출 버튼 제공
 *
 * 사용처:
 * - 회원가입/로그인 시 다단계 설문조사
 */

interface StepsManagerProps {
  currentStep: number
  onNextStep: () => void
  onPrevStep: () => void
}

// ... (StepsManagerProps 인터페이스 동일) ...

// --- [개선 1: 규칙 #4 적용] ---
// StepTwoFooter는 StepTwo와 "항상 같이 실행되는" 코드입니다.
// 따라서 StepTwoView 라는 하나의 컴포넌트로 묶어 책임을 위임합니다.

/**
 * [규칙 #4] Step 2에서 실행되는 모든 UI (폼 + 푸터)
 */
function StepTwoView({ onPrevStep }: { onPrevStep: () => void }) {
  const { isSubmitting } = useShopSurvey()
  const form = useFormContext()

  // '쇼핑 시작하기' 버튼 비활성화 조건 (규칙 #6 적용)
  const watchedIsOperating = form.watch("isOperating")
  const watchedCategories = form.watch("categories")
  const isSubmitDisabled =
    watchedIsOperating === undefined ||
    watchedCategories.length === 0 ||
    isSubmitting

  return (
    <>
      {/* 1. 스텝 2 폼 영역 */}
      <StepTwoForm />

      {/* 2. 스텝 2 푸터 영역 */}
      <footer className="mt-8 flex w-full gap-2">
        <CustomButton
          variant="outline"
          size="lg"
          disabled={isSubmitDisabled}
        >
          건너뛰기
        </CustomButton>
      </footer>
    </>
  )
}

export default function StepsManager({
  currentStep,
  onNextStep,
  onPrevStep,
}: StepsManagerProps) {
  // --- [개선 2: 규칙 #6 적용] ---
  // 헷갈리는 배열 인덱싱({steps[currentStep]})을 제거합니다.
  // currentStep 값에 따라 어떤 뷰가 렌더링되는지 명확히 드러냅니다.
  // 이제 StepsManager는 "정책 결정"만 담당합니다.

  switch (currentStep) {
    case 0:
      return <StepOne onNextStep={onNextStep} />
    case 1:
      return <StepTwoView onPrevStep={onPrevStep} />
    default:
      // 예기치 않은 스텝에 대한 기본값 처리
      return <StepOne onNextStep={onNextStep} />
  }
}
