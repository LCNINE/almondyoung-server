import { z } from "zod"

const MAX_CONTENT_LENGTH = 2000
const MIN_CONTENT_LENGTH = 10
const MAX_TITLE_LENGTH = 200

const QUESTION_CATEGORIES = [
  "product",
  "delivery",
  "order",
  "exchange",
  "account",
  "etc",
] as const

interface ValidationMessages {
  categoryRequired: string
  subCategoryRequired: string
  titleRequired: string
  titleMax: string
  contentMin: string
  contentMax: string
}

export function buildInquiryFormSchema(messages: ValidationMessages) {
  return z.object({
    category: z.enum(QUESTION_CATEGORIES, {
      message: messages.categoryRequired,
    }),
    subCategory: z.string().min(1, messages.subCategoryRequired),
    title: z
      .string()
      .min(1, messages.titleRequired)
      .max(MAX_TITLE_LENGTH, messages.titleMax),
    content: z
      .string()
      .min(MIN_CONTENT_LENGTH, messages.contentMin)
      .max(MAX_CONTENT_LENGTH, messages.contentMax),
  })
}

export type InquiryFormValues = z.infer<ReturnType<typeof buildInquiryFormSchema>>

export { MAX_CONTENT_LENGTH, MIN_CONTENT_LENGTH, MAX_TITLE_LENGTH }
