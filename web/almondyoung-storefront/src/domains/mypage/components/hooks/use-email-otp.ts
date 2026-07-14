"use client"

import {
  sendEmailCodeApi,
  verifyEmailCodeApi,
} from "@lib/api/users/email-verification"
import type { EmailOtpPurpose } from "@lib/types/dto/users"
import { useEffect, useState, useTransition } from "react"

type Handlers = { onError?: (message: string) => void; onSuccess?: () => void }

// useTwilio 의 이메일 버전. 내부 toast 없이 상태만 관리하고 UX 는 호출부(t()) 가 담당.
// 401 은 api 클라이언트가 re-throw → transition 밖으로 전파되어 error.tsx 가 토큰 복구.
export function useEmailOtp() {
  const [isCodeSendPending, startSend] = useTransition()
  const [isCodeVerifyPending, startVerify] = useTransition()
  const [isCodeSent, setIsCodeSent] = useState(false)
  const [isCodeVerified, setIsCodeVerified] = useState(false)
  const [timer, setTimer] = useState(180)

  useEffect(() => {
    if (isCodeSent && timer > 0) {
      const id = setInterval(() => setTimer((prev) => prev - 1), 1000)
      return () => clearInterval(id)
    }
  }, [isCodeSent, timer])

  const sendCode = (purpose: EmailOtpPurpose, handlers?: Handlers) => {
    startSend(async () => {
      const result = await sendEmailCodeApi({ purpose })
      if ("data" in result) {
        setIsCodeSent(true)
        setTimer(180)
      } else {
        handlers?.onError?.(result.error.message)
      }
    })
  }

  const verifyCode = (
    code: string,
    purpose: EmailOtpPurpose,
    handlers?: Handlers
  ) => {
    startVerify(async () => {
      const result = await verifyEmailCodeApi({ code, purpose })
      if ("data" in result) {
        setIsCodeVerified(true)
        handlers?.onSuccess?.()
      } else {
        setIsCodeVerified(false)
        handlers?.onError?.(result.error.message)
      }
    })
  }

  const reset = () => {
    setIsCodeSent(false)
    setIsCodeVerified(false)
    setTimer(180)
  }

  return {
    sendCode,
    verifyCode,
    isCodeSendPending,
    isCodeVerifyPending,
    isCodeSent,
    isCodeVerified,
    timer,
    reset,
  }
}
