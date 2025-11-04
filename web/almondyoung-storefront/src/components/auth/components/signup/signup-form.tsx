"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useSignup } from "@components/auth/hooks/use-signup"
import { SignupSchema, signupSchema } from "@components/auth/schemas/signup-schema"
import { CustomButton } from "@components/common/custom-buttons"
import { Spinner } from "@components/common/spinner"
import { Form } from "@components/common/ui/form"
import { useForm } from "react-hook-form"
import { AgreementsSection } from "./agreement"
import { SignupFormFields } from "./signup-form-fields"

export function SignupForm() {
  const form = useForm<SignupSchema>({
    resolver: zodResolver(signupSchema),
    mode: "onChange",
    defaultValues: {
      // 회원 정보 필드
      loginId: "",
      username: "",
      nickname: "",
      email: "",
      password: "",
      passwordConfirm: "",
      // 필수 약관
      isOver14: false,
      termsOfService: false,
      electronicTransaction: false,
      privacyPolicy: false,
      thirdPartySharing: false,

      // 선택 약관
      marketingConsent: false,
    },
  })

  const { signup, isLoading } = useSignup(form)

  const onSubmit = async (data: SignupSchema) => {
    await signup(data)
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        {/* 회원 정보 입력 필드들 */}
        <SignupFormFields form={form} />

        {/* 약관 동의 섹션 */}
        <div className="h-32 overflow-y-auto py-4">
        <AgreementsSection form={form} />
        </div>
        {/* 제출 버튼 */}
        <div className="w-full">
          <CustomButton
            type="submit"
            disabled={!form.formState.isValid || isLoading}
            className={`h-[42px] w-full ${
              !form.formState.isValid
                ? "bg-gray-70 cursor-not-allowed"
                : "cursor-pointer"
            }`}
          >
            {isLoading ? (
              <Spinner size="sm" color="white" />
            ) : (
              "동의하고 가입하기"
            )}
          </CustomButton>
        </div>
      </form>
    </Form>
  )
}
