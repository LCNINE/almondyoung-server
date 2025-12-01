"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"

interface SecurityKeypadProps {
  title: string
  onComplete: (pin: string) => void
  onCancel?: () => void
  showForgotPassword?: boolean
  onForgotPassword?: () => void
  errorMessage?: string
  failureCount?: number
  maxFailureCount?: number
}

/**
 * 보안 키패드 컴포넌트
 * - 6자리 숫자 입력
 * - 랜덤 키 배열 (0-9)
 * - Dot 표시 (●●●●●●)
 * - Shake 애니메이션 (오류 시)
 */
export function SecurityKeypad({
  title,
  onComplete,
  onCancel,
  showForgotPassword = false,
  onForgotPassword,
  errorMessage,
  failureCount,
  maxFailureCount = 5,
}: SecurityKeypadProps) {
  const [pin, setPin] = useState<string>("")
  const [keypadNumbers, setKeypadNumbers] = useState<number[]>([])
  const [isShaking, setIsShaking] = useState(false)

  // 랜덤 키패드 배열 생성
  useEffect(() => {
    const numbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const shuffled = [...numbers].sort(() => Math.random() - 0.5)
    setKeypadNumbers(shuffled)
  }, [])

  // 에러 메시지가 변경되면 흔들림 애니메이션 실행
  useEffect(() => {
    if (errorMessage) {
      setIsShaking(true)
      const timer = setTimeout(() => setIsShaking(false), 500)
      return () => clearTimeout(timer)
    }
  }, [errorMessage])

  // PIN 검증 (프론트엔드 보안 검증)
  const validatePin = (inputPin: string): boolean => {
    // 연속 숫자 체크 (123456, 234567 등)
    const isSequential = /(012|123|234|345|456|567|678|789|890)/.test(inputPin)
    if (isSequential) {
      toast.error("연속된 숫자는 사용할 수 없습니다.")
      return false
    }

    // 반복 숫자 체크 (111111, 222222 등)
    const isRepeating = /^(\d)\1{5}$/.test(inputPin)
    if (isRepeating) {
      toast.error("반복된 숫자는 사용할 수 없습니다.")
      return false
    }

    return true
  }

  // 완료 핸들러 (검증 포함)
  const handleComplete = useCallback(
    (inputPin: string) => {
      // 프론트엔드 보안 검증 (등록 시에만)
      if (title.includes("설정") || title.includes("등록")) {
        if (!validatePin(inputPin)) {
          setPin("")
          return
        }
      }

      onComplete(inputPin)
    },
    [title, onComplete]
  )

  // PIN 입력
  const handleNumberClick = useCallback(
    (num: number) => {
      if (pin.length < 6) {
        const newPin = pin + num.toString()
        setPin(newPin)

        // 6자리 입력 완료 시 자동으로 완료 처리
        if (newPin.length === 6) {
          // 약간의 딜레이 후 완료 (UX 개선)
          setTimeout(() => {
            handleComplete(newPin)
          }, 100)
        }
      }
    },
    [pin, handleComplete]
  )

  // 지우기
  const handleDelete = useCallback(() => {
    setPin((prev) => prev.slice(0, -1))
  }, [])

  // 취소
  const handleCancel = useCallback(() => {
    setPin("")
    onCancel?.()
  }, [onCancel])

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 제목 */}
      <h2 className="text-center text-lg font-semibold text-black">{title}</h2>

      {/* Dot 표시 영역 */}
      <div
        className={`flex items-center justify-center gap-3 transition-all ${
          isShaking ? "animate-[shake_0.5s_ease-in-out]" : ""
        }`}
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className={`h-4 w-4 rounded-full border-2 transition-all ${
              index < pin.length
                ? "border-amber-500 bg-amber-500"
                : "border-gray-300 bg-transparent"
            }`}
          />
        ))}
      </div>

      {/* 에러 메시지 및 실패 횟수 */}
      {(errorMessage || (failureCount !== undefined && failureCount > 0)) && (
        <div className="text-center">
          {errorMessage && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}
          {failureCount !== undefined && failureCount > 0 && (
            <p className="mt-1 text-xs text-gray-600">
              남은 시도 횟수: {maxFailureCount - failureCount}/{maxFailureCount}
            </p>
          )}
        </div>
      )}

      {/* 키패드 */}
      <div className="grid grid-cols-3 gap-4">
        {keypadNumbers.map((num) => (
          <button
            key={num}
            type="button"
            onClick={() => handleNumberClick(num)}
            disabled={pin.length >= 6}
            className="flex h-14 items-center justify-center rounded-lg border-2 border-gray-300 bg-white text-xl font-semibold text-black transition-all hover:bg-gray-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {num}
          </button>
        ))}
        {/* 지우기 버튼 */}
        <button
          type="button"
          onClick={handleDelete}
          disabled={pin.length === 0}
          className="flex h-14 items-center justify-center rounded-lg border-2 border-gray-300 bg-white text-sm font-semibold text-black transition-all hover:bg-gray-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          지우기
        </button>
        {/* 취소 버튼 */}
        {onCancel && (
          <button
            type="button"
            onClick={handleCancel}
            className="flex h-14 items-center justify-center rounded-lg border-2 border-gray-300 bg-white text-sm font-semibold text-black transition-all hover:bg-gray-50 active:scale-95"
          >
            취소
          </button>
        )}
      </div>

      {/* 비밀번호를 잊으셨나요? */}
      {showForgotPassword && onForgotPassword && (
        <button
          type="button"
          onClick={onForgotPassword}
          className="text-center text-sm text-gray-600 underline transition-colors hover:text-gray-800"
        >
          비밀번호를 잊으셨나요?
        </button>
      )}
    </div>
  )
}

