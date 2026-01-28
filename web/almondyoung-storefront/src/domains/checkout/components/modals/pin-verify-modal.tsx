"use client"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import PinDots from "@/domains/payment/components/security-pin/shared/pin-dots"
import PinKeypad from "@/domains/payment/components/security-pin/pin-keypad"
import { usePinKeypad } from "@/domains/payment/components/security-pin/hooks/use-pin-keypad"
import { verifyPin } from "@/lib/api/wallet"
import { HttpApiError } from "@/lib/api/api-error"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

interface PinVerifyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const PIN_LENGTH = 6

export function PinVerifyModal({
  open,
  onOpenChange,
  onSuccess,
}: PinVerifyModalProps) {
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isShaking, setIsShaking] = useState(false)
  const [isPending, startTransition] = useTransition()
  const { shuffledNumbers, shuffleKeypad } = usePinKeypad(true)

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (open) {
      setPin("")
      setError(null)
      setIsShaking(false)
      shuffleKeypad()
    }
  }, [open])

  const handleNumberClick = (value: string | number) => {
    if (isPending) return

    if (value === "backspace") {
      setPin((prev) => prev.slice(0, -1))
      setError(null)
    } else if (value !== "" && pin.length < PIN_LENGTH) {
      const newPin = pin + value
      setPin(newPin)
      setError(null)

      // 6자리 입력 완료 시 자동 검증
      if (newPin.length === PIN_LENGTH) {
        handleVerify(newPin)
      }
    }
  }

  const handleVerify = (inputPin: string) => {
    startTransition(async () => {
      try {
        const result = await verifyPin(inputPin)

        if (result.verified) {
          toast.success("PIN 인증에 성공했습니다")
          handleClose()
          onSuccess()
        } else {
          handleFailure("PIN이 일치하지 않습니다")
        }
      } catch (err) {
        if (err instanceof HttpApiError) {
          handleFailure(err.message)
        } else {
          handleFailure("PIN 인증에 실패했습니다. 다시 시도해주세요.")
        }
      }
    })
  }

  const handleFailure = (message: string) => {
    setError(message)
    setIsShaking(true)

    setTimeout(() => {
      setIsShaking(false)
      setPin("")
      shuffleKeypad()
    }, 500)
  }

  const handleClose = () => {
    setPin("")
    setError(null)
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader className="text-center">
          <AlertDialogTitle>결제 비밀번호 입력</AlertDialogTitle>
          <AlertDialogDescription>
            결제를 진행하려면 PIN을 입력해주세요
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col items-center py-2">
          <PinDots
            length={PIN_LENGTH}
            filledCount={pin.length}
            isShaking={isShaking}
          />

          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        </div>

        <PinKeypad
          shuffledNumbers={shuffledNumbers}
          handleNumberClick={handleNumberClick}
          pin={pin}
          isPending={isPending}
        />

        <div className="flex justify-center">
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={isPending}
            className="text-gray-500"
          >
            취소
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
