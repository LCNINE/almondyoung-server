import type { BusinessMetadata, NtsLookupResult } from "@lib/types/dto/users"
import z from "zod"

export const buildBusinessDtoSchema = (messages: {
  businessNumberRequired: string
  representativeNameRequired: string
}) =>
  z
    .object({
      businessNumber: z.string(),
      representativeName: z.string(),
      fileUrl: z.string().url().optional(),
      file: z.instanceof(File).optional(),
      metadata: z.custom<BusinessMetadata>().optional(),
      isSubmitting: z.boolean(),
      // 국세청 상태조회 결과. 제출 시 metadata.nts 로 저장된다.
      nts: z.custom<NtsLookupResult>().nullable(),
    })
    .superRefine((data, ctx) => {
      // 파일 첨부 모드면 번호/대표자명은 필요 없다.
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
    })

export type BusinessDtoSchema = z.infer<
  ReturnType<typeof buildBusinessDtoSchema>
>
