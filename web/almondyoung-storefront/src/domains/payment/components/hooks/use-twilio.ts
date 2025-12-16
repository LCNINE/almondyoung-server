import { HttpApiError } from "@lib/api/api-error"
import { sendTwilioMessageApi, verifyCodeApi } from "@lib/api/users/twilio"
import type { SendTwilioMessageDto, VerifyCodeDto } from "@lib/types/dto/users"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

export const useTwilio = () => {
  const [isCodeSendPending, startCodeSendTransition] = useTransition()
  const [isCodeVerifyPending, startCodeVerifyTransition] = useTransition()
  const [isCodeSent, setIsCodeSent] = useState(false) // 인증번호 발송 여부
  const [isCodeVerified, setIsCodeVerified] = useState(false) // 인증번호 검증 여부
  const [timer, setTimer] = useState(60) // 1분 (60초)

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
      try {
        const result = await sendTwilioMessageApi(data)
        if (result) {
          toast.success("인증번호가 발송되었습니다.")
          setIsCodeSent(true)
          setTimer(60)
        }
      } catch (error) {
        if (error instanceof HttpApiError) {
          if (error.status === 429) {
            toast.error(
              "너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요."
            )
            return
          }
        }

        toast.error("인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.")
        return
      }
    })
  }

  // 인증번호 검증
  const verifyCode = (data: VerifyCodeDto) => {
    startCodeVerifyTransition(async () => {
      try {
        const result = await verifyCodeApi(data)
        if (result) {
          toast.success("인증번호가 검증되었습니다.")
          setIsCodeVerified(true)
        }
      } catch (error) {
        toast.error("인증번호 검증에 실패했습니다. 잠시 후 다시 시도해주세요.")
        setIsCodeVerified(false)
        return
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
