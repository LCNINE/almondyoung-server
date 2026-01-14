import z from "zod"

export const shopTypeEnum = z.enum(["", "solo", "small", "large"])

export const shopSurveySchema = z
  .object({
    isOperating: z.boolean(), // 현재 운영 중 여부
    yearsOperating: z.number(), // 운영 연수
    shopType: shopTypeEnum, // 매장 유형
    categories: z.array(z.string()), // 취급 카테고리
    targetCustomers: z.array(z.string()), // 주요 고객층
    openDays: z.array(z.string()), // 영업 요일
  })
  .superRefine((data, ctx) => {
    if (data.isOperating) {
      if (data.yearsOperating < 0) {
        ctx.addIssue({
          code: "custom",
          path: ["yearsOperating"],
          message: "운영 연수는 0 이상이어야 합니다.",
        })
      }
    }
  })

export type ShopSurveySchema = z.infer<typeof shopSurveySchema>
