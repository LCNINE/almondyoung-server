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

export const inquiryFormSchema = z.object({
  category: z.enum(QUESTION_CATEGORIES, {
    message: "문의 유형을 선택해주세요.",
  }),
  subCategory: z.string().min(1, "세부 유형을 선택해주세요."),
  title: z
    .string()
    .min(1, "제목을 입력해주세요.")
    .max(MAX_TITLE_LENGTH, `제목은 ${MAX_TITLE_LENGTH}자 이하로 입력해주세요.`),
  content: z
    .string()
    .min(MIN_CONTENT_LENGTH, `최소 ${MIN_CONTENT_LENGTH}자 이상 입력해주세요.`)
    .max(
      MAX_CONTENT_LENGTH,
      `최대 ${MAX_CONTENT_LENGTH.toLocaleString()}자까지 입력 가능합니다.`
    ),
})

export type InquiryFormValues = z.infer<typeof inquiryFormSchema>

export { MAX_CONTENT_LENGTH, MIN_CONTENT_LENGTH, MAX_TITLE_LENGTH }
