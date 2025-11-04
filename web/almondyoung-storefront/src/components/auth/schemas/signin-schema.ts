import z from "zod"

export const signinSchema = z.object({
  loginId: z.string().min(1, "아이디를 입력해주세요"),
  password: z
    .string()
    .min(1, "비밀번호를 입력해주세요")
    .min(8, "비밀번호는 최소 8자 이상이어야 합니다"),
  rememberMe: z.boolean(),
  loginIdRemember: z.boolean(),
})

export type SigninSchema = z.infer<typeof signinSchema>
