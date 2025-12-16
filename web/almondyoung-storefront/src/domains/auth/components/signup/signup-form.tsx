"use client"

import { CustomButton } from "@components/common/custom-buttons"
import { Spinner } from "@components/common/spinner"
import { Form } from "@components/common/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { createUser } from "@lib/api/users/auth/signup-base"
import { signupSchema, SignupSchema } from "domains/auth/schemas/signup-schema"
import { useSearchParams } from "next/navigation"
import { useActionState, useEffect, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { AgreementsSection } from "./agreement"
import { SignupFormFields } from "./signup-form-fields"

export function SignupForm() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect_to") || undefined

  const [state, formAction, pending] = useActionState(createUser, null)
  const [isPending, startTransition] = useTransition()

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

  useEffect(() => {
    if (state) {
      if (state.success) {
        toast(state.message, {
          action: {
            label: "확인",
            onClick: () => {},
          },
        })
      } else {
        toast.error(state.message)
      }
    }
  }, [state])

  const onSubmit = async (data: SignupSchema) => {
    const { passwordConfirm, ...submitData } = data

    startTransition(() => {
      formAction({
        ...submitData,
        redirectTo,
      })
    })
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
            disabled={!form.formState.isValid || pending || isPending}
            className={`h-[42px] w-full ${
              !form.formState.isValid
                ? "bg-gray-70 cursor-not-allowed"
                : "cursor-pointer"
            }`}
          >
            {pending || isPending ? (
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
