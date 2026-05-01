"use client"

import { KeyRound, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useSecuritySheetStore } from "../store/security-sheet-store"
import PinKeypad from "./pin-keypad"
import PinDots from "./shared/pin-dots"

interface PinSheetProps {
  pinLength?: number
  title?: string
  description?: string
  useRandomKeypad?: boolean
}

export function PinSheet({
  pinLength = 6,
  title = "핀트 비밀번호를 입력해 주세요.",
  description = "혹시, 비밀번호를 잊으셨나요?",
  useRandomKeypad = true,
}: PinSheetProps) {
  const { isOpen, closeSheet } = useSecuritySheetStore()
  const [pin, setPin] = useState<string>("")
  const [isShaking, setIsShaking] = useState(false)
  const [shuffledNumbers, setShuffledNumbers] = useState<(number | string)[]>(
    []
  )

  // 바깥 스크롤 막기
  useEffect(() => {
    if (isOpen) {
      // 현재 스크롤 위치 저장
      const scrollY = window.scrollY
      document.body.style.position = "fixed"
      document.body.style.top = `-${scrollY}px`
      document.body.style.width = "100%"
      document.body.style.overflow = "hidden"

      return () => {
        // 원래 스크롤 위치로 복원
        document.body.style.position = ""
        document.body.style.top = ""
        document.body.style.width = ""
        document.body.style.overflow = ""
        window.scrollTo(0, scrollY)
      }
    }
  }, [isOpen])

  // 랜덤 키패드 생성
  useEffect(() => {
    if (isOpen) {
      if (useRandomKeypad) {
        const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
        const shuffled = [...numbers].sort(() => Math.random() - 0.5)

        const grid = [...shuffled.slice(0, 9), "", shuffled[9], "backspace"]
        setShuffledNumbers(grid)
      } else {
        setShuffledNumbers([1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "backspace"])
      }
      setPin("")
    }
  }, [isOpen, useRandomKeypad])

  useEffect(() => {
    if (pin.length === pinLength) {
      setTimeout(() => {
        // onComplete(pin);
        setTimeout(() => setPin(""), 300)
      }, 200)
    }
  }, [pin, pinLength])

  const handleNumberClick = (value: string | number) => {
    if (value === "backspace") {
      setPin((prev) => prev.slice(0, -1))
    } else if (value !== "" && pin.length < pinLength) {
      setPin((prev) => prev + value)

      if (typeof window !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(10)
      }
    }
  }

  const handleForgotPin = () => {
    console.log("비밀번호 찾기")
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="animate-in fade-in fixed inset-0 z-50 bg-black/50 duration-200"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Bottom Sheet Container  */}
      <div className="fixed inset-0 z-9999 flex items-end justify-center sm:items-center sm:p-4">
        <div className="animate-in slide-in-from-bottom sm:zoom-in relative h-full w-full rounded-t-3xl bg-white shadow-2xl duration-300 sm:max-w-md sm:rounded-3xl md:h-[70vh] md:max-h-[650px]">
          {/* Header */}
          <div className="relative flex items-center justify-center border-b border-gray-100 pt-6 pb-4">
            <button
              onClick={closeSheet}
              className="absolute right-6 rounded-full p-2 transition-all hover:bg-gray-100 active:scale-90"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>

            {/* 보안 표시 */}
            {useRandomKeypad && (
              <div className="absolute left-6 flex items-center gap-1 text-xs text-green-600">
                <svg
                  className="h-4 w-4"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="hidden sm:inline">보안키패드</span>
                <span className="sm:hidden">보안</span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex h-[calc(100%-73px)] flex-col px-4 pt-6 pb-4 sm:px-6 sm:pt-8 sm:pb-6">
            {/* Icon & Title */}
            <div className="mb-6 flex flex-col items-center sm:mb-8">
              <div className="animate-in zoom-in mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 duration-300 sm:mb-6 sm:h-16 sm:w-16">
                <KeyRound className="h-7 w-7 text-amber-500 sm:h-8 sm:w-8" />
              </div>

              <h2 className="animate-in fade-in slide-in-from-bottom mb-2 text-center text-lg font-bold text-gray-900 delay-100 duration-300 sm:text-xl">
                {title}
              </h2>

              {/* PIN Dots */}
              <PinDots
                length={pinLength}
                filledCount={pin.length}
                isShaking={isShaking}
              />
            </div>

            {/* Forgot PIN */}
            <button
              onClick={handleForgotPin}
              className="mb-auto text-center text-sm text-gray-400 transition-colors hover:text-gray-600"
            >
              {description}
            </button>

            {/* Keypad */}
            <PinKeypad
              shuffledNumbers={shuffledNumbers}
              handleNumberClick={handleNumberClick}
              pin={pin}
            />
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes shake {
          0%,
          100% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-10px);
          }
          75% {
            transform: translateX(10px);
          }
        }
        .animate-shake {
          animation: shake 0.4s ease-in-out;
        }
      `}</style>
    </>
  )
}
