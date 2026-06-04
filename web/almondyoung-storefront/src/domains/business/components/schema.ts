import z from "zod"

export const buildBusinessDtoSchema = (messages: {
  infoOrFileRequired: string
}) =>
  z
    .object({
      businessNumber: z.string(),
      representativeName: z.string(),
      fileUrl: z.string().url().optional(),
      file: z.instanceof(File).optional(),
      metadata: z.unknown().optional(),
      isSubmitting: z.boolean(),
      externalBusinessStatus: z.enum(["success", "failed", "null"]),
    })
    .superRefine((data, ctx) => {
      const hasBusinessInfo =
        data.businessNumber?.length > 0 && data.representativeName?.length > 0

      const hasFile = data.file || data.fileUrl

      if (!hasBusinessInfo && !hasFile) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.infoOrFileRequired,
          path: ["root"],
        })
      }
    })

export type BusinessDtoSchema = z.infer<
  ReturnType<typeof buildBusinessDtoSchema>
>
