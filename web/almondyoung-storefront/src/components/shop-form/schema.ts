import { z } from "zod"

// 매장 규모 enum
export const shopTypeEnum = z.enum(["", "solo", "small", "large"])

export const shopFormSchema = z
  .object({
    // 샵 운영 여부 (필수)
    isOperating: z.boolean(),
    // 운영 연수
    yearsOperating: z.number().min(0, "운영 기간을 선택해주세요."),
    // 매장 규모
    shopType: shopTypeEnum,
    // 시술 카테고리 (최소 1개)
    categories: z
      .array(z.string())
      .min(1, "시술 종류를 최소 1개 이상 선택해주세요."),
    // 고객층
    targetCustomers: z.array(z.string()),
    // 운영 요일
    openDays: z.array(z.string()),
  })
  .superRefine((data, ctx) => {
    if (data.isOperating && data.yearsOperating < 0) {
      ctx.addIssue({
        code: "custom",
        path: ["yearsOperating"],
        message: "운영 연수는 0 이상이어야 합니다.",
      })
    }
  })

export type ShopFormSchema = z.infer<typeof shopFormSchema>
