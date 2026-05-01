import z from "zod"

export const forgetPinSchema = z
  .object({
    phoneNumber: z.string().min(1, "휴대폰 번호를 입력해주세요"),
    verificationCode: z.string(),
    step: z.enum(["phone", "verify", "success"]),
    countryCode: z.string().min(1, "국가 코드를 선택해주세요"),
    purpose: z.enum(["forget_pin", "phone_verify"]).optional(),
  })
  .refine(
    (data) => {
      if (data.step === "verify") {
        return data.verificationCode.length === 6
      }
      return true
    },
    {
      message: "6자리 인증번호를 입력해주세요",
      path: ["verificationCode"],
    }
  )

export type ForgetPinSchema = z.infer<typeof forgetPinSchema>
