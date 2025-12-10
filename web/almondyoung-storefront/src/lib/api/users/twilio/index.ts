import { HttpApiError } from "../../api-error"
import { SendTwilioMessageDto } from "./types"
import { VerifyCodeDto } from "./types"

export const sendTwilioMessageApi = async (data: SendTwilioMessageDto) => {
  const response = await fetch("/api/twilio/send-verify-code", {
    method: "POST",
    body: JSON.stringify(data),
  })

  const resData = await response.json()

  if (!response.ok) {
    throw new HttpApiError(
      resData.error || "Failed to send message",
      response.status,
      response.statusText,
      data
    )
  }

  return resData
}

export const verifyCodeApi = async (data: VerifyCodeDto) => {
  const response = await fetch("/api/twilio/verify-code", {
    method: "POST",
    body: JSON.stringify(data),
  })

  const resData = await response.json()

  if (!response.ok) {
    throw new HttpApiError(
      resData.error || "Failed to verify code",
      response.status,
      response.statusText,
      data
    )
  }

  return resData
}
