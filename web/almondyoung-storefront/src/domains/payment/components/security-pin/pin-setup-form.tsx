"use client"

import { Card } from "@components/common/ui/card"
import { Form } from "@components/common/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { registerPin, resetPin } from "@lib/api/wallet"
import { toLocalizedPath } from "@/lib/utils/locale-path"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useState, useTransition, useEffect } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { usePinKeypad } from "./hooks/use-pin-keypad"
import PinKeypad from "./pin-keypad"
import {
  pinSetupSchema,
  type PinSetupFormValues,
} from "./schemas/pin-validation"
import PinDots from "./shared/pin-dots"

type Step = "input" | "confirm" | "success"

export default function PinSetupForm({
  redirectTo,
  isForgetPinPage = false,
}: {
  redirectTo?: string
  isForgetPinPage?: boolean
}) {
  const router = useRouter()
  const { countryCode } = useParams() as { countryCode?: string }
  const currentCountryCode = countryCode ?? "kr"

  const [step, setStep] = useState<Step>("input")
  const [isShaking, setIsShaking] = useState(false)
  const { shuffledNumbers, shuffleKeypad } = usePinKeypad(true)

  const [isPending, startTransition] = useTransition()
  const [countdown, setCountdown] = useState<number | null>(null)

  const form = useForm<PinSetupFormValues>({
    resolver: zodResolver(pinSetupSchema),
    defaultValues: {
      firstPin: "",
      secondPin: "",
    },
    mode: "onChange",
  })

  const currentPin =
    step === "input" ? form.watch("firstPin") : form.watch("secondPin")

  const handleNumberClick = (value: string | number) => {
    const fieldName = step === "input" ? "firstPin" : "secondPin"
    const currentValue = form.getValues(fieldName)

    if (value === "backspace") {
      form.setValue(fieldName, currentValue.slice(0, -1), {
        shouldValidate: true,
      })
    } else if (value !== "" && currentValue.length < 6) {
      const newPin = currentValue + value
      form.setValue(fieldName, newPin, {
        shouldValidate: true,
      })

      // 햅틱 피드백
      if (typeof window !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(10)
      }

      // 6자리 입력 완료 시
      if (newPin.length === 6) {
        handlePinComplete(fieldName)
      }
    }
  }

  const handlePinComplete = async (fieldName: "firstPin" | "secondPin") => {
    if (fieldName === "firstPin") {
      // 첫 번째 PIN 유효성 검사
      const result = await form.trigger("firstPin")

      if (result) {
        // 유효하면 확인 단계로
        setTimeout(() => {
          setStep("confirm")
          shuffleKeypad()
        }, 300)
      } else {
        // 유효하지 않으면 shake + 초기화
        triggerShakeAndReset()

        // 에러 메시지 토스트
        const error = form.formState.errors.firstPin
        if (error) {
          toast.error(error.message ?? "PIN 설정 실패")
        }
      }
    } else {
      // 두 번째 PIN 검증
      const result = await form.trigger()
      // 일치하면 저장
      if (result) {
        await savePin(form.getValues().secondPin, isForgetPinPage)
      } else {
        // 불일치하면 shake + 초기화
        triggerShakeAndReset()

        const error = form.formState.errors.secondPin

        if (error) {
          toast.error(error.message ?? "PIN 불일치")
        }
      }
    }
  }

  const savePin = async (pin: string, isForgetPinPage: boolean) => {
    startTransition(async () => {
      try {
        if (isForgetPinPage) {
          await resetPin(pin)
        } else {
          await registerPin(pin)
        }

        // 성공 화면
        setStep("success")
        toast.success("PIN 설정 완료")

        // 리다이렉트가 필요한 경우 카운트다운 시작
        if (redirectTo) {
          setCountdown(3)
        }
      } catch (error: any) {
        console.error("PIN 저장 실패:", error)
        toast.error(error.message ?? "PIN 저장 실패")

        // 처음부터 다시 입력
        form.reset()
        setStep("input")
        shuffleKeypad()
      }
    })
  }

  // 카운트다운 및 자동 리다이렉트 처리
  useEffect(() => {
    if (countdown === null || !redirectTo) return

    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1)
      }, 1000)
      return () => clearTimeout(timer)
    } else {
      // 카운트다운이 0이 되면 리다이렉트
      router.push(toLocalizedPath(currentCountryCode, redirectTo))
    }
  }, [countdown, currentCountryCode, redirectTo, router])

  // 수동 리다이렉트 핸들러
  const handleRedirect = () => {
    if (redirectTo) {
      router.push(toLocalizedPath(currentCountryCode, redirectTo))
    } else {
      router.push(toLocalizedPath(currentCountryCode, "/mypage/payment"))
    }
  }

  const triggerShakeAndReset = () => {
    setIsShaking(true)

    setTimeout(() => {
      setIsShaking(false)
      form.reset()
      setStep("input")
      shuffleKeypad()
    }, 500)
  }

  const handleReset = () => {
    form.reset()
    setStep("input")
    shuffleKeypad()
  }

  // 성공 화면
  if (step === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="mb-6 flex justify-center">
            <div className="animate-in zoom-in flex h-20 w-20 items-center justify-center rounded-full bg-green-100 duration-500">
              <CheckCircle2 className="h-10 w-10 text-green-600" />
            </div>
          </div>
          <h2 className="mb-2 text-2xl font-bold text-gray-900">
            PIN 설정 완료!
          </h2>
          <p className="mb-4 text-gray-600">
            보안 PIN이 성공적으로 설정되었습니다.
          </p>

          {/* 리다이렉트가 있는 경우 카운트다운 및 버튼 표시 */}
          {redirectTo && countdown !== null && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                {countdown > 0
                  ? `${countdown}초 후 자동으로 이동합니다`
                  : "이동 중..."}
              </p>
              <button
                type="button"
                onClick={handleRedirect}
                className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
              >
                지금 이동하기
              </button>
            </div>
          )}

          {/* 리다이렉트가 없는 경우 (forget-pin 페이지 등) */}
          {!redirectTo && (
            <button
              type="button"
              onClick={() =>
                router.push(toLocalizedPath(currentCountryCode, "/mypage/payment"))
              }
              className="mt-4 w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            >
              결제 수단 관리로 이동
            </button>
          )}
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center">
      <Card className="w-full max-w-md p-6 max-sm:border-none max-sm:shadow-none sm:p-8">
        <Form {...form}>
          <form className="space-y-8">
            {/* Header */}
            <div className="flex flex-col items-center">
              <h2 className="mb-2 text-center text-xl font-bold text-gray-900">
                {step === "input" ? "PIN 설정" : "PIN 확인"}
              </h2>
              <p className="text-center text-sm text-gray-600">
                {step === "input"
                  ? "사용하실 6자리 PIN을 입력해주세요"
                  : "동일한 PIN을 다시 입력해주세요"}
              </p>

              {/* PIN Dots */}
              <PinDots
                length={6}
                filledCount={currentPin.length}
                isShaking={isShaking}
              />

              {/* 에러 메시지 표시 */}
              {step === "input" && form.formState.errors.firstPin && (
                <div className="mt-4 flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  <span>{form.formState.errors.firstPin.message}</span>
                </div>
              )}

              {step === "confirm" && form.formState.errors.secondPin && (
                <div className="mt-4 flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  <span>{form.formState.errors.secondPin.message}</span>
                </div>
              )}
            </div>

            {/* Security Badge */}
            <div className="flex items-center justify-center gap-2 text-xs text-green-600">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                  clipRule="evenodd"
                />
              </svg>
              <span>보안키패드</span>
            </div>

            {/* Keypad */}
            <PinKeypad
              shuffledNumbers={shuffledNumbers}
              handleNumberClick={handleNumberClick}
              pin={currentPin}
              isPending={isPending}
            />

            {/* Reset Button (confirm 단계에서만) */}
            {step === "confirm" && (
              <button
                type="button"
                onClick={handleReset}
                className="w-full text-center text-sm text-gray-500 hover:text-gray-700"
              >
                처음부터 다시 입력
              </button>
            )}
          </form>
        </Form>
      </Card>
    </div>
  )
}
