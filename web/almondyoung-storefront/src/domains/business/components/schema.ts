import z from "zod"

export const buildBusinessDtoSchema = (messages: {
  businessNumberRequired: string
  representativeNameRequired: string
  startDateRequired: string
  startDateInvalid: string
}) =>
  z
    .object({
      businessNumber: z.string(),
      representativeName: z.string(),
      // 개업일자(YYYYMMDD). 국세청 진위확인에 사업자번호·대표자명과 함께 반드시 필요하다.
      startDate: z.string(),
      fileUrl: z.string().url().optional(),
      file: z.instanceof(File).optional(),
    })
    .superRefine((data, ctx) => {
      // 파일 첨부 모드면 번호/대표자명/개업일자는 필요 없다.
      if (data.file || data.fileUrl) return

      if (!data.businessNumber || data.businessNumber.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.businessNumberRequired,
          path: ["businessNumber"],
        })
      }
      if (!data.representativeName || data.representativeName.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.representativeNameRequired,
          path: ["representativeName"],
        })
      }

      const startDate = data.startDate?.replace(/\D/g, "") ?? ""
      if (startDate.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.startDateRequired,
          path: ["startDate"],
        })
      } else if (!/^\d{8}$/.test(startDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.startDateInvalid,
          path: ["startDate"],
        })
      }
    })

export type BusinessDtoSchema = z.infer<
  ReturnType<typeof buildBusinessDtoSchema>
>
