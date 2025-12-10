export type SendTwilioMessageDto = {
  countryCode: string
  phoneNumber: string
}

export type VerifyCodeDto = {
  code: string
  phoneNumber: string
}
