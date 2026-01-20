"use client"

import { useState } from "react"
import { KeyRound } from "lucide-react"
import { Card } from "@components/common/ui/card"
import PinKeypad from "./pin-keypad"
import PinDots from "./shared/pin-dots"
import { usePinKeypad } from "./hooks/use-pin-keypad"

interface PinVerificationFormProps {
  onSuccess: () => void
  onFail?: () => void
  title?: string
  maxAttempts?: number
}

export default function PinVerificationForm({
  title = "PIN을 입력해주세요",
  maxAttempts = 5,
}: PinVerificationFormProps) {
  const [pin, setPin] = useState("")
  const [isShaking, setIsShaking] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const { shuffledNumbers, shuffleKeypad } = usePinKeypad(true)

  const handleNumberClick = (value: string | number) => {
    if (value === "backspace") {
      setPin((prev) => prev.slice(0, -1))
    } else if (value !== "" && pin.length < 6) {
      const newPin = pin + value
      setPin(newPin)

      if (newPin.length === 6) {
        verifyPin(newPin)
      }
    }
  }

  const verifyPin = async (inputPin: string) => {
    try {
      // TODO: API 호출
      const response = await fetch("/api/user/pin/verify", {
        method: "POST",
        body: JSON.stringify({ pin: inputPin }),
      })

      if (response.ok) {
        // onSuccess()
      } else {
        handleFailure()
      }
    } catch (error) {
      handleFailure()
    }
  }

  const handleFailure = () => {
    setIsShaking(true)
    setAttempts((prev) => prev + 1)

    setTimeout(() => {
      setIsShaking(false)
      setPin("")
      shuffleKeypad()
    }, 500)

    if (attempts + 1 >= maxAttempts) {
      // onFail?.()
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 p-4">
      <Card className="w-full max-w-md p-6 max-sm:border-none max-sm:shadow-none sm:p-8">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
            <KeyRound className="h-8 w-8 text-amber-600" />
          </div>

          <h2 className="mb-2 text-center text-xl font-bold text-gray-900">
            {title}
          </h2>

          <PinDots length={6} filledCount={pin.length} isShaking={isShaking} />

          {attempts > 0 && (
            <p className="mt-4 text-sm text-red-600">
              PIN이 일치하지 않습니다 ({attempts}/{maxAttempts})
            </p>
          )}
        </div>

        <PinKeypad
          shuffledNumbers={shuffledNumbers}
          handleNumberClick={handleNumberClick}
          pin={pin}
        />
      </Card>
    </div>
  )
}
