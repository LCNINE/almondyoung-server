import z from "zod"

export const paymentMethodFormSchema = z
  .object({
    bankCode: z.string().min(1, "은행을 선택해주세요"),
    accountNumber: z.string().min(1, "계좌번호를 입력해주세요"),
    accountHolderName: z.string().min(1, "예금주를 입력해주세요"),
    accountHolderBirthDate: z.string().min(1, "예금주 생년월일을 입력해주세요"),
    electronicTransaction: z.boolean(), // 전자금융거래 이용약관 동의
    privacyPolicy: z.boolean(), // 개인정보 수집 및 이용 동의
    thirdPartySharing: z.boolean(), // 개인정보 제3자 제공 동의
    billingDate: z.string().min(1, "결제일을 선택해주세요"),
    birthDate: z.string().min(1, "생년월일을 입력해주세요"),
    signature: z.instanceof(File, {
      message: "서명을 해주세요.",
    }),
  })
  .superRefine((data, ctx) => {
    if (!data.electronicTransaction) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "전자금융거래 이용약관 동의는 필수입니다",
        path: ["electronicTransaction"],
      })
    }

    if (!data.privacyPolicy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "개인정보 수집 및 이용 동의는 필수입니다",
        path: ["privacyPolicy"],
      })
    }

    if (!data.thirdPartySharing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "개인정보 제3자 제공 동의는 필수입니다",
        path: ["thirdPartySharing"],
      })
    }
  })

export type PaymentMethodFormSchema = z.infer<typeof paymentMethodFormSchema>
