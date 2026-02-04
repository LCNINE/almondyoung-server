import z from "zod"

export const profileSchema = z.object({
  username: z.string().min(1, "이름을 입력해주세요"),
  nickname: z.string().min(1, "닉네임을 입력해주세요"),
  birthday: z
    .string()
    .regex(
      /^\d{8}$/,
      "생년월일은 YYYYMMDD 형식으로 입력해주세요 (예: 19900101)"
    )
    .or(z.literal("")),
})

export type ProfileSchema = z.infer<typeof profileSchema>
