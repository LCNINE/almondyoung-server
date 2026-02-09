import { cn } from "@lib/utils"
import { Button } from "@components/common/ui/button"
import { Checkbox } from "@components/common/ui/checkbox"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@components/common/ui/form"
import { RadioGroup, RadioGroupItem } from "@components/common/ui/radio-group"
import { Check } from "lucide-react"
import { useFormContext } from "react-hook-form"
import React from "react"
import {
  CATEGORIES,
  CATEGORY_WIDTH_MAP,
  DEFAULT_CATEGORY_WIDTH,
} from "@/components/shop-form/constants"

/**
 * 샵 설문조사 Step 1
 */

interface StepOneProps {
  onNextStep: () => void
}

// --- (이전 리팩토링) 캡슐화된 라벨 컴포넌트들 (규칙 #4 와 유사) ---
interface SurveyRadioLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  isChecked: boolean
}
const SurveyRadioLabel: React.FC<SurveyRadioLabelProps> = ({
  children,
  isChecked,
  ...props
}) => (
  <FormLabel
    {...props}
    className={cn(
      "text-[12px] leading-[15px] tracking-[-0.01em] text-[#757575]",
      "relative inline-flex items-center justify-center",
      "px-4 py-2.5",
      "tracking-tight",
      "rounded-[10px] border border-[#D9D9D9]",
      "bg-white text-sm font-medium shadow-md",
      "cursor-pointer transition-all duration-200 select-none",
      isChecked && ["border-[#FFA500]", "bg-[#FFA500] text-white"]
    )}
  >
    {children}
    {isChecked && <Check className="absolute top-2 right-0 h-4 w-4" />}
  </FormLabel>
)

interface CategoryCheckboxLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  isChecked: boolean
}
const CategoryCheckboxLabel: React.FC<CategoryCheckboxLabelProps> = ({
  children,
  isChecked,
  ...props
}) => (
  <FormLabel
    {...props}
    className={cn(
      "text-[12px] leading-[15px] tracking-[-0.01em] whitespace-nowrap text-[#757575]",
      "flex items-center justify-center",
      "h-[43px] w-full px-3",
      "rounded-[10px] border border-[#D9D9D9] bg-white shadow-md",
      "cursor-pointer text-sm font-medium tracking-tight",
      "transition-all duration-200 select-none",
      isChecked && "border-[#FFA500] bg-[#FFA500] text-white"
    )}
  >
    {children}
  </FormLabel>
)
// --- 캡슐화 컴포넌트 정의 끝 ---

export function StepOne({ onNextStep }: StepOneProps) {
  const form = useFormContext()

  // '다음' 버튼 비활성화 조건을 명시적 변수로 분리 (가독성)
  const watchedIsOperating = form.watch("isOperating")
  const watchedCategories = form.watch("categories")
  const isNextDisabled =
    watchedIsOperating === undefined || watchedCategories.length === 0

  const handleNext = () => {
    // 유효성 검사 로직 (규칙 #8: handleNext는 검사 로직을 포함하는 것이 예측 가능함)
    if (watchedIsOperating === undefined) {
      form.setError("isOperating", { message: "샵 운영 여부를 선택해주세요." })
      return
    }
    if (watchedCategories.length === 0) {
      form.setError("categories", { message: "카테고리를 선택해주세요." })
      return
    }
    onNextStep()
  }

  return (
    <>
      {/* 헤더 (시맨틱 마크업) */}
      <header>
        <h2 id="step1-title" className="section-title text-left">
          환영합니다!
          <br />
          어떤 분야에 계신가요?
        </h2>
        <p className="mt-5 text-xs -tracking-wide">
          최상의 경험을 위한 정보를 등록하세요 아몬드영이
          <span className="text-yellow-30"> 빠른 구매</span>를 도와드릴게요!
        </p>
      </header>

      {/* 샵 운영 여부 (시맨틱 <section>) */}
      <section aria-labelledby="isOperating-label">
        <FormField
          control={form.control}
          name="isOperating"
          render={({ field }) => (
            <FormItem>
              <FormLabel
                id="isOperating-label"
                className="text-gray-90 mb-4 block text-left text-[16px] font-bold"
              >
                샵을 운영 중이신가요?
              </FormLabel>
              <FormControl>
                <RadioGroup
                  onValueChange={(value) => field.onChange(value === "true")}
                  value={String(field.value)}
                  className="flex"
                >
                  <FormItem>
                    <FormControl>
                      <RadioGroupItem
                        value="true"
                        id="isOperating-yes"
                        className="sr-only"
                      />
                    </FormControl>
                    <SurveyRadioLabel
                      htmlFor="isOperating-yes"
                      isChecked={field.value === true}
                    >
                      네, 샵을 운영중이에요
                    </SurveyRadioLabel>
                  </FormItem>
                  <FormItem>
                    <FormControl>
                      <RadioGroupItem
                        value="false"
                        id="isOperating-no"
                        className="sr-only"
                      />
                    </FormControl>
                    <SurveyRadioLabel
                      htmlFor="isOperating-no"
                      isChecked={field.value === false}
                    >
                      아니요, 예비 창업이에요
                    </SurveyRadioLabel>
                  </FormItem>
                </RadioGroup>
              </FormControl>
              <FormMessage className="ml-2" />
            </FormItem>
          )}
        />
      </section>

      {/* 카테고리 다중 선택 (시맨틱 <section>) */}
      <section aria-labelledby="categories-label">
        <FormField
          control={form.control}
          name="categories"
          render={({ field }) => {
            // --- [개선 2: 규칙 #8 (숨은 로직 드러내기)] ---
            // 'onCheckedChange'의 인라인 로직을 명명된 함수로 분리합니다.
            // "체크 시 배열을 업데이트한다"는 로직의 의도를 명확히 드러냅니다.
            const handleCategoryChange = (
              category: string,
              checked: boolean
            ) => {
              const currentCategories = Array.isArray(field.value)
                ? field.value
                : []
              const newCategories = checked
                ? [...currentCategories, category]
                : currentCategories.filter((v: string) => v !== category)
              field.onChange(newCategories)
            }

            return (
              <FormItem>
                <FormLabel
                  id="categories-label"
                  className="text-gray-90 mb-[22px] block text-left text-[16px] font-bold"
                >
                  어떤 시술을 취급(또는 준비)하고 계신가요?
                  <br />
                  (다중 선택 가능)
                </FormLabel>

                <div className="space- flex max-w-[375px] flex-wrap justify-around gap-2">
                  {CATEGORIES.map((cat) => {
                    const isChecked = field.value?.includes(cat)
                    const inputId = `cat-${cat}`

                    return (
                      // [개선 1] 함수 호출 대신 객체 룩업 사용
                      <div
                        key={cat}
                        className={
                          CATEGORY_WIDTH_MAP[cat] ?? DEFAULT_CATEGORY_WIDTH
                        }
                      >
                        <FormControl>
                          <Checkbox
                            checked={isChecked}
                            // [개선 2] 명명된 핸들러 호출
                            onCheckedChange={(checked) =>
                              handleCategoryChange(cat, !!checked)
                            }
                            className="sr-only"
                            id={inputId}
                          />
                        </FormControl>
                        <CategoryCheckboxLabel
                          htmlFor={inputId}
                          isChecked={isChecked}
                        >
                          {cat}
                        </CategoryCheckboxLabel>
                      </div>
                    )
                  })}
                </div>
                <FormMessage />
              </FormItem>
            )
          }}
        />
      </section>

      {/* 다음 버튼 (시맨틱 <footer>) */}
      <footer className="mt-8 flex justify-end">
        <Button
          size="lg"
          type="button"
          variant="outline"
          className={cn(
            "cursor-pointer transition-all duration-200",
            "hover:text-gray-90 hover:bg-transparent",
            isNextDisabled && "opacity-50"
          )}
          onClick={handleNext}
          disabled={isNextDisabled} // 시각적 비활성화(opacity)와 실제 비활성화(disabled)를 일치시킵니다.
        >
          다음
        </Button>
      </footer>
    </>
  )
}
