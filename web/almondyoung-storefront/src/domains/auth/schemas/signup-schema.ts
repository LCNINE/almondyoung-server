import z from "zod"

export const signupSchema = z
  .object({
    loginId: z
      .string()
      .min(1, "아이디를 입력해주세요")
      .min(6, "아이디는 최소 6자 이상이어야 합니다")
      .regex(
        /^[a-z0-9]+$/,
        "아이디는 영문 소문자와 숫자만 사용할 수 있습니다"
      ),
    password: z
      .string()
      .min(1, "비밀번호를 입력해주세요")
      .min(8, "비밀번호는 최소 8자 이상이어야 합니다")
      .max(16, "비밀번호는 최대 16자 이하이어야 합니다")
      .regex(
        /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~])/,
        "영문, 숫자, 특수문자를 모두 포함해야 합니다"
      ),
    passwordConfirm: z
      .string()
      .min(8, "비밀번호를 입력해주세요")
      .max(16, "비밀번호는 최대 16자 이하이어야 합니다"),
    email: z.string().email("이메일 형식이 올바르지 않습니다"),
    username: z.string().min(1, "이름을 입력해주세요"),
    nickname: z.string().min(1, "닉네임을 입력해주세요"),
    birthday: z
      .string()
      .min(1, "생년월일을 입력해주세요")
      .regex(
        /^\d{8}$/,
        "생년월일은 YYYYMMDD 형식으로 입력해주세요 (예: 19900101)"
      ),
    phoneNumber: z.string().min(1, "휴대폰 번호를 입력해주세요"),
    verificationCode: z.string(),
    countryCode: z.string(),
    isPhoneVerified: z.boolean(),
    // 필수 약관
    isOver14: z.boolean().refine((val) => val === true, {
      message: "필수 약관에 동의해주세요",
    }),

    termsOfService: z.boolean().refine((val) => val === true, {
      message: "필수 약관에 동의해주세요",
    }),

    electronicTransaction: z.boolean().refine((val) => val === true, {
      message: "필수 약관에 동의해주세요",
    }),

    privacyPolicy: z.boolean().refine((val) => val === true, {
      message: "필수 약관에 동의해주세요",
    }),

    thirdPartySharing: z.boolean().refine((val) => val === true, {
      message: "필수 약관에 동의해주세요",
    }),
    marketingConsent: z.boolean().optional(),
    encryptedIdToken: z.string().optional(),
  })
  // 비밀번호 일치 체크
  .refine((data) => data.password === data.passwordConfirm, {
    message: "비밀번호가 일치하지 않습니다",
    path: ["passwordConfirm"],
  })

export type SignupSchema = z.infer<typeof signupSchema>
