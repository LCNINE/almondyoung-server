import { sendVerificationCodeApi, verifyCodeApi } from "@lib/api/users/phone-verification"
import type { SendVerificationCodeDto, VerifyCodeDto } from "@lib/types/dto/users"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

export const usePhoneVerification = () => {
  const [isCodeSendPending, startCodeSendTransition] = useTransition()
  const [isCodeVerifyPending, startCodeVerifyTransition] = useTransition()
  const [isCodeSent, setIsCodeSent] = useState(false) // 인증번호 발송 여부
  const [isCodeVerified, setIsCodeVerified] = useState(false) // 인증번호 검증 여부
  const [timer, setTimer] = useState(180) // 3분 (180초)

  useEffect(() => {
    if (isCodeSent && timer > 0) {
      const interval = setInterval(() => {
        setTimer((prev) => prev - 1)
      }, 1000)

      return () => clearInterval(interval)
    }
  }, [isCodeSent, timer])

  // 인증번호 발송
  const sendVerificationCode = (data: SendVerificationCodeDto) => {
    startCodeSendTransition(async () => {
      const result = await sendVerificationCodeApi(data)
      if ("data" in result) {
        toast.success("인증번호가 발송되었습니다.")
        setIsCodeSent(true)
        setTimer(180)
      } else {
        console.error("인증번호 발송 실패:", result.error)
        toast.error(result.error.message)
      }
    })
  }

  // 인증번호 검증
  const verifyCode = (data: VerifyCodeDto) => {
    startCodeVerifyTransition(async () => {
      const result = await verifyCodeApi(data)
      if ("data" in result) {
        toast.success("인증번호가 검증되었습니다.")
        setIsCodeVerified(true)
      } else {
        toast.error(result.error.message)
        setIsCodeVerified(false)
      }
    })
  }

  // 상태 초기화
  const reset = () => {
    setIsCodeSent(false)
    setIsCodeVerified(false)
    setTimer(180)
  }

  return {
    sendVerificationCode,
    isCodeSendPending,
    isCodeSent,
    verifyCode,
    isCodeVerifyPending,
    isCodeVerified,
    timer,
    reset,
  }
}

export default usePhoneVerification
