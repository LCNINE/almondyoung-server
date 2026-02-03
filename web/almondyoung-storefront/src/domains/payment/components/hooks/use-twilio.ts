import { sendTwilioMessageApi, verifyCodeApi } from "@lib/api/users/twilio"
import type { SendTwilioMessageDto, VerifyCodeDto } from "@lib/types/dto/users"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

export const useTwilio = () => {
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
  const sendTwilioMessage = (data: SendTwilioMessageDto) => {
    startCodeSendTransition(async () => {
      const result = await sendTwilioMessageApi(data)
      if ("data" in result) {
        toast.success("인증번호가 발송되었습니다.")
        setIsCodeSent(true)
        setTimer(180)
      } else {
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

  return {
    sendTwilioMessage,
    isCodeSendPending,
    isCodeSent,
    verifyCode,
    isCodeVerifyPending,
    isCodeVerified,
    timer,
  }
}

export default useTwilio
