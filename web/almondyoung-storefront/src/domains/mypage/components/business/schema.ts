import z from "zod"
export const businessDtoSchema = z
  .object({
    businessNumber: z.string().min(1, "사업자등록번호를 입력해주세요"),
    representativeName: z.string().min(1, "대표자명을 입력해주세요"),
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
