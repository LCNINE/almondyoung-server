"use client"

import { Button } from "@components/common/ui/button"
import { Card } from "@components/common/ui/card"
import { changePin, verifyPin } from "@lib/api/wallet"
import { CheckCircle2, Lock } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { usePinKeypad } from "./hooks/use-pin-keypad"
import PinKeypad from "./pin-keypad"
import PinDots from "./shared/pin-dots"
import Link from "next/link"

type Step = "question" | "current" | "new" | "confirm" | "success"

export default function PinChangeForm() {
  const [step, setStep] = useState<Step>("question")
  const [currentPin, setCurrentPin] = useState("")
  const [newPin, setNewPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [isShaking, setIsShaking] = useState(false)
  const { shuffledNumbers, shuffleKeypad } = usePinKeypad(true)
  const [isPending, startTransition] = useTransition()

  // 질문 단계
  if (step === "question") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <Card className="w-full max-w-md p-8 max-sm:border-none max-sm:shadow-none">
          <h2 className="mb-3 text-center text-2xl font-semibold text-gray-900">
            PIN 번호를 변경할까요?
          </h2>
          <p className="mb-8 text-center text-sm text-gray-600">
            보안을 위해 주기적으로 PIN을 변경하는 것을 권장합니다
          </p>

          <div className="space-y-3">
            <Button
              onClick={() => {
                setStep("current")
                shuffleKeypad()
              }}
              className="h-12 w-full text-base font-medium"
            >
              변경하기
            </Button>

            <div className="flex items-center gap-2">
              <Link href="/mypage/payment/forget-pin">PIN 비밀번호 찾기</Link>
              <Button
                variant="ghost"
                onClick={() => window.history.back()}
                className="ml-auto cursor-pointer text-sm font-normal hover:bg-transparent hover:text-gray-700"
              >
                나중에 할게요
              </Button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  // 성공 단계
  if (step === "success") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <Card className="w-full max-w-md p-8 text-center max-sm:border-none max-sm:shadow-none">
          <h2 className="mb-3 text-2xl font-semibold text-gray-900">
            변경 완료!
          </h2>
          <p className="mb-8 text-gray-600">
            PIN 번호가 안전하게 변경되었습니다
          </p>

          <Button
            onClick={() => window.history.back()}
            className="h-12 w-full text-base"
          >
            확인
          </Button>
        </Card>
      </div>
    )
  }

  const getCurrentPin = () => {
    if (step === "current") return currentPin
    if (step === "new") return newPin
    if (step === "confirm") return confirmPin
    return ""
  }

  const handleNumberClick = async (value: string | number) => {
    const pin = getCurrentPin()

    if (value === "backspace") {
      if (step === "current") setCurrentPin((prev) => prev.slice(0, -1))
      if (step === "new") setNewPin((prev) => prev.slice(0, -1))
      if (step === "confirm") setConfirmPin((prev) => prev.slice(0, -1))
      return
    }

    if (value !== "" && pin.length < 6) {
      const newPinValue = pin + value

      if (step === "current") {
        setCurrentPin(newPinValue)
        if (newPinValue.length === 6) {
          startTransition(async () => {
            try {
              await verifyPin(newPinValue)
              setTimeout(() => {
                setStep("new")
                shuffleKeypad()
              }, 300)
            } catch (error: any) {
              toast.error("현재 PIN이 맞지 않아요")
              triggerShake(() => setCurrentPin(""))
            }
          })
        }
      }

      if (step === "new") {
        setNewPin(newPinValue)
        if (newPinValue.length === 6) {
          setTimeout(() => {
            setStep("confirm")
            shuffleKeypad()
          }, 300)
        }
      }

      if (step === "confirm") {
        setConfirmPin(newPinValue)
        if (newPinValue.length === 6) {
          if (newPin === newPinValue) {
            startTransition(async () => {
              try {
                await changePin(currentPin, newPinValue)
                setStep("success")
              } catch (error: any) {
                console.error("PIN 변경 실패:", error)

                toast.error(
                  error.message ?? "PIN 변경에 실패했어요. 다시 시도해주세요"
                )
                triggerShake(() => {
                  setCurrentPin("")
                  setNewPin("")
                  setConfirmPin("")
                  setStep("current")
                  shuffleKeypad()
                })
              }
            })
          } else {
            toast.error("PIN이 일치하지 않아요. 처음부터 다시 입력해주세요")
            triggerShake(() => {
              setCurrentPin("")
              setNewPin("")
              setConfirmPin("")
              setStep("current")
              shuffleKeypad()
            })
          }
        }
      }
    }
  }

  const triggerShake = (callback: () => void) => {
    setIsShaking(true)
    setTimeout(() => {
      setIsShaking(false)
      callback()
    }, 500)
  }

  const getStepInfo = () => {
    const steps = {
      current: {
        title: "현재 PIN을 입력해주세요",
        description: "본인 확인을 위해 현재 사용 중인 PIN을 입력해주세요",
        icon: <Lock className="h-6 w-6 text-blue-600" />,
      },
      new: {
        title: "새로운 PIN을 만들어주세요",
        description: "6자리 숫자로 새로운 PIN을 설정해주세요",
        icon: <Lock className="h-6 w-6 text-blue-600" />,
      },
      confirm: {
        title: "한 번 더 입력해주세요",
        description: "방금 입력한 PIN을 다시 한번 확인해주세요",
        icon: <CheckCircle2 className="h-6 w-6 text-blue-600" />,
      },
    }
    return steps[step as keyof typeof steps]
  }

  const stepInfo = getStepInfo()

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md p-6 max-sm:border-none max-sm:shadow-none sm:p-8">
        {/* 진행 표시 */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${step === "current" ? "bg-blue-600" : "bg-gray-300"}`}
          />
          <div
            className={`h-2 w-2 rounded-full ${step === "new" ? "bg-blue-600" : "bg-gray-300"}`}
          />
          <div
            className={`h-2 w-2 rounded-full ${step === "confirm" ? "bg-blue-600" : "bg-gray-300"}`}
          />
        </div>

        <div className="mb-8 flex flex-col items-center">
          <div className="bg-gray-10 mb-4 rounded-full p-3">
            {stepInfo.icon}
          </div>

          <h2 className="mb-2 text-center text-xl font-semibold text-gray-900">
            {stepInfo.title}
          </h2>
          <p className="mb-6 text-center text-sm text-gray-500">
            {stepInfo.description}
          </p>

          <PinDots
            length={6}
            filledCount={getCurrentPin().length}
            isShaking={isShaking}
          />
        </div>

        <PinKeypad
          shuffledNumbers={shuffledNumbers}
          handleNumberClick={handleNumberClick}
          pin={getCurrentPin()}
          isPending={isPending}
        />

        {/* 취소 버튼 */}
        <button
          onClick={() => {
            if (step === "current") {
              setStep("question")
            } else {
              toast("처음부터 다시 시작할게요")
              setCurrentPin("")
              setNewPin("")
              setConfirmPin("")
              setStep("current")
              shuffleKeypad()
            }
          }}
          className="mt-4 w-full py-2 text-sm text-gray-500 hover:text-gray-700"
        >
          {step === "current" ? "취소" : "처음으로"}
        </button>
      </Card>
    </div>
  )
}
