import z from "zod"
export const businessDtoSchema = z
  .object({
    businessNumber: z.string(),
    representativeName: z.string(),
    fileUrl: z.string().url().optional(),
    file: z.instanceof(File).optional(),
    metadata: z.unknown().optional(),
    isSubmitting: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const hasBusinessInfo =
      data.businessNumber?.length > 0 && data.representativeName?.length > 0

    const hasFile = data.file || data.fileUrl

    if (!hasBusinessInfo && !hasFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "사업자 정보 또는 파일이 필요합니다",
        path: ["root"],
      })
    }
  })

export type BusinessDtoSchema = z.infer<typeof businessDtoSchema>
