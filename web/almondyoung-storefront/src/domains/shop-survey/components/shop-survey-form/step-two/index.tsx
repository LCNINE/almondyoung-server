import { useState } from "react"
import { cn } from "@lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { NumberStepper } from "@/components/shared/number-stepper"
import { Checkbox } from "@components/common/ui/checkbox"
import { Label } from "@components/common/ui/label"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import {
  TARGET_CUSTOMERS,
  DAYS_OF_WEEK,
  SHOP_TYPES,
} from "@/components/shop-form/constants"
import { useFormContext } from "react-hook-form"
import { useRouter } from "next/navigation"
import { updateSurveyRemind } from "@/lib/api/users/shop-suvery"

function YearsOperatingSection({
  value,
  onChange,
  error,
}: {
  value: number
  onChange: (value: number) => void
  error?: string
}) {
  return (
    <section aria-labelledby="yearsOperating-label">
      <div className="flex w-full flex-col">
        <h3
          id="yearsOperating-label"
          className="mb-[20px] text-[16px] font-bold"
        >
          얼마나 운영하셨나요?
        </h3>

        <div className="flex items-center gap-2">
          <NumberStepper
            yearsOperating={value}
            increment={() => onChange(value + 1)}
            decrement={() => onChange(value - 1)}
            setValue={onChange}
          />
          <span className="text-xs font-bold">년차</span>
        </div>
        {error && <p className="text-sm font-medium text-red-500">{error}</p>}
      </div>
    </section>
  )
}

function ShopTypeSection({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  return (
    <section aria-labelledby="shopType-label">
      <div>
        <h3
          id="shopType-label"
          className="text-gray-90 mt-4 mb-4 block text-[16px] font-bold"
        >
          어떤 유형의 매장인가요?
        </h3>

        <div className="flex flex-wrap gap-2">
          {SHOP_TYPES.map(({ value: shopValue, label }) => (
            <div key={shopValue}>
              <input
                type="radio"
                value={shopValue}
                id={shopValue}
                checked={value === shopValue}
                onChange={(e) => onChange(e.target.value)}
                className="sr-only"
              />
              <Label
                htmlFor={shopValue}
                className={cn(
                  "inline-flex items-center justify-center",
                  "gap-2.5 rounded-[10px] px-4 py-3.5",
                  "bg-white shadow-[0px_4px_4px_0px_rgba(0,0,0,0.10)]",
                  "outline-[0.50px] outline-offset-[-0.50px] outline-[#D9D9D9]",
                  "font-['Pretendard'] text-xs leading-none font-normal",
                  "tracking-[-0.01em] whitespace-nowrap text-[#757575]",
                  "cursor-pointer transition-all duration-200 select-none",
                  value === shopValue && [
                    "outline-[#FFA500]",
                    "bg-[#FFA500] text-white",
                  ]
                )}
              >
                {label}
              </Label>
            </div>
          ))}
        </div>

        {error && (
          <p className="mt-2 ml-2 text-sm font-medium text-red-500">{error}</p>
        )}
      </div>
    </section>
  )
}

function TargetCustomersSection({
  value,
  onChange,
  error,
}: {
  value: string[]
  onChange: (value: string[]) => void
  error?: string
}) {
  const handleToggle = (target: string) => {
    if (value.includes(target)) {
      onChange(value.filter((v) => v !== target))
    } else {
      onChange([...value, target])
    }
  }

  return (
    <section aria-labelledby="targetCustomers-label">
      <div className="w-full">
        <h3
          id="targetCustomers-label"
          className="text-gray-90 mb-[22px] block text-[16px] font-bold"
        >
          주요 고객층은 누구인가요? (다중 선택 가능)
        </h3>

        <div className="flex flex-wrap gap-[8px]">
          {TARGET_CUSTOMERS.map((target) => {
            const isTargetSelected = value?.includes(target)

            return (
              <div key={target}>
                <Checkbox
                  checked={isTargetSelected}
                  onCheckedChange={() => handleToggle(target)}
                  className="sr-only"
                  id={`target-${target}`}
                />
                <Label
                  htmlFor={`target-${target}`}
                  className={cn(
                    "inline-block rounded-[10px] bg-white px-[18px] py-[14px]",
                    "shadow-[0_4px_4px_rgba(0,0,0,0.1)]",
                    "text-xs leading-tight tracking-[-0.01em]",
                    "transition-colors duration-200 ease-in-out",
                    "cursor-pointer select-none",
                    isTargetSelected
                      ? "bg-[#ffa500] text-white"
                      : "text-black hover:bg-[#ffa500] hover:text-white"
                  )}
                >
                  {target}
                </Label>
              </div>
            )
          })}
        </div>

        {error && <p className="text-sm font-medium text-red-500">{error}</p>}
      </div>
    </section>
  )
}

function OpenDaysSection({
  value,
  onChange,
  error,
}: {
  value: string[]
  onChange: (value: string[]) => void
  error?: string
}) {
  const handleToggle = (day: string) => {
    if (value.includes(day)) {
      onChange(value.filter((v) => v !== day))
    } else {
      onChange([...value, day])
    }
  }

  return (
    <section aria-labelledby="openDays-label">
      <div className="w-full">
        <h3
          id="openDays-label"
          className="text-gray-90 mb-[22px] block text-[16px] font-bold"
        >
          샵 운영 요일 (다중 선택 가능)
        </h3>

        <div className="flex flex-wrap gap-[8px]">
          {DAYS_OF_WEEK.map((day) => {
            const isDaySelected = value?.includes(day)

            return (
              <div key={day}>
                <Checkbox
                  checked={isDaySelected}
                  onCheckedChange={() => handleToggle(day)}
                  className="sr-only"
                  id={`day-${day}`}
                />
                <Label
                  htmlFor={`day-${day}`}
                  className={cn(
                    "rounded-[10px] bg-white px-4 py-3.5",
                    "shadow-[0px_4px_4px_0px_rgba(0,0,0,0.10)]",
                    "outline outline-offset-[-0.50px]",
                    "inline-flex items-center justify-center gap-2.5",
                    "font-['Pretendard'] text-xs leading-none font-normal",
                    "cursor-pointer transition-all duration-200 select-none",
                    isDaySelected
                      ? "bg-[#FFA500] text-white outline-[#FFA500]"
                      : "text-[#757575] outline-[#D9D9D9] hover:bg-[#FFF5E6] hover:outline-[#FFA500]"
                  )}
                >
                  {day}
                </Label>
              </div>
            )
          })}
        </div>

        {error && <p className="text-sm font-medium text-red-500">{error}</p>}
      </div>
    </section>
  )
}

export function StepTwo() {
  const [showSkipDialog, setShowSkipDialog] = useState(false)
  const [isSkipping, setIsSkipping] = useState(false)
  const router = useRouter()
  const { watch, setValue: setFormValue, formState } = useFormContext()
  const { isSubmitting, errors: formErrors } = formState

  const handleSkip = async () => {
    setIsSkipping(true)
    await updateSurveyRemind()
    router.push("/")
  }

  const isOperating = watch("isOperating")
  const yearsOperating = watch("yearsOperating")
  const shopType = watch("shopType")
  const targetCustomers = watch("targetCustomers")
  const openDays = watch("openDays")
  const categories = watch("categories")

  const errors = {
    yearsOperating: formErrors.yearsOperating?.message as string | undefined,
    shopType: formErrors.shopType?.message as string | undefined,
    targetCustomers: formErrors.targetCustomers?.message as string | undefined,
    openDays: formErrors.openDays?.message as string | undefined,
  }

  const isSubmitDisabled =
    isOperating === undefined || categories?.length === 0 || isSubmitting

  const setValue = (field: string, value: unknown) => {
    setFormValue(field, value, {
      shouldValidate: true,
      shouldDirty: true,
    })
  }

  return (
    <>
      {isOperating && (
        <YearsOperatingSection
          value={yearsOperating}
          onChange={(v) => setValue("yearsOperating", v)}
          error={errors.yearsOperating}
        />
      )}

      <ShopTypeSection
        value={shopType}
        onChange={(v) => setValue("shopType", v)}
        error={errors.shopType}
      />

      <TargetCustomersSection
        value={targetCustomers}
        onChange={(v) => setValue("targetCustomers", v)}
        error={errors.targetCustomers}
      />

      {isOperating && (
        <OpenDaysSection
          value={openDays}
          onChange={(v) => setValue("openDays", v)}
          error={errors.openDays}
        />
      )}

      <footer className="mt-8 flex w-full gap-2">
        <CustomButton
          variant="outline"
          size="lg"
          disabled={isSubmitting || isSkipping}
          type="button"
          onClick={() => setShowSkipDialog(true)}
        >
          건너뛰기
        </CustomButton>

        <CustomButton
          variant="fill"
          size="lg"
          disabled={isSubmitDisabled || isSkipping}
          type="submit"
          isLoading={isSubmitting}
        >
          제출하기
        </CustomButton>
      </footer>

      <AlertDialog open={showSkipDialog} onOpenChange={setShowSkipDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>설문을 건너뛰시겠어요?</AlertDialogTitle>
            <AlertDialogDescription>
              지금까지 입력하신 내용은 저장되지 않아요.
              <br />
              나중에 다시 맞춤 설정을 진행하실 수 있습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSkipping}>
              계속 작성하기
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleSkip} disabled={isSkipping}>
              {isSkipping ? "처리 중..." : "건너뛰기"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
