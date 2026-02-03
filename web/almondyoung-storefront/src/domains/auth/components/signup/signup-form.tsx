"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Form } from "@/components/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { createUser } from "@lib/api/users/auth/signup-base"
import { formatBirthday } from "@lib/utils/format-birthday"
import { signupSchema, SignupSchema } from "domains/auth/schemas/signup-schema"
import { setFormError } from "domains/auth/utils/set-form-error"
import { useSearchParams } from "next/navigation"
import { useActionState, useEffect, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { SignupFormFields } from "./signup-form-fields"

export function SignupForm() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect_to") || "/"

  const [state, formAction, pending] = useActionState(createUser, null)
  const [isPending, startTransition] = useTransition()

  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false)
  const [hasAgreed, setHasAgreed] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)

  const form = useForm<SignupSchema>({
    resolver: zodResolver(signupSchema),
    mode: "onChange",
    defaultValues: {
      loginId: "",
      username: "",
      nickname: "",
      email: "",
      password: "",
      passwordConfirm: "",
      birthday: "",
      phoneNumber: "",
      verificationCode: "",
      countryCode: "KR",
      isPhoneVerified: false,
      isOver14: false,
      termsOfService: false,
      electronicTransaction: false,
      privacyPolicy: false,
      thirdPartySharing: false,
      marketingConsent: false,
    },
  })

  useEffect(() => {
    if (state) {
      if (state.success) {
        setIsRedirecting(true)
        window.location.href = `/api/auth/callback/signup?userId=${state.userId}&redirect_to=${encodeURIComponent(redirectTo)}`
      } else {
        toast.error(state.message)
        setFormError(state.message, form)
        setIsConfirmDialogOpen(false)
      }
    }
  }, [state])

  const onSubmit = async (data: SignupSchema) => {
    const {
      passwordConfirm,
      verificationCode,
      countryCode,
      isPhoneVerified,
      ...submitData
    } = data
    const formattedBirthday = formatBirthday(submitData.birthday)

    const formattedSubmitData = {
      ...submitData,
      birthday: formattedBirthday,
    }

    startTransition(() => {
      formAction(formattedSubmitData)
    })
  }

  const handleSignupClick = async () => {
    const isPhoneVerified = form.getValues("isPhoneVerified")
    if (!isPhoneVerified) {
      form.setError("isPhoneVerified", {
        type: "manual",
        message: "휴대폰 인증을 완료해주세요",
      })
    }

    const isValid = await form.trigger([
      "loginId",
      "username",
      "nickname",
      "email",
      "password",
      "passwordConfirm",
      "birthday",
      "phoneNumber",
    ])

    if (!isValid || !isPhoneVerified) return

    // 이미 약관 동의한 경우 바로 제출
    if (hasAgreed) {
      form.handleSubmit(onSubmit)()
      return
    }

    setIsConfirmDialogOpen(true)
  }

  const handleConfirmSignup = () => {
    setHasAgreed(true)

    // 모든 필수 약관에 자동 동의 처리
    form.setValue("isOver14", true)
    form.setValue("termsOfService", true)
    form.setValue("electronicTransaction", true)
    form.setValue("privacyPolicy", true)
    form.setValue("thirdPartySharing", true)

    form.handleSubmit(onSubmit)()
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex w-full flex-col gap-4"
        id="signup-form"
      >
        <SignupFormFields form={form} />

        <div className="ml-auto">
          <CustomButton
            type="button"
            className="cursor-pointer"
            disabled={pending || isPending || isRedirecting}
            isLoading={pending || isPending || isRedirecting}
            onClick={handleSignupClick}
          >
            가입하기
          </CustomButton>
        </div>
      </form>

      <Dialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>약관 동의 안내</DialogTitle>
            <DialogDescription>
              가입을 계속하시면 이용약관, 전자금융거래 약관, 개인정보 수집 및
              이용, 개인정보 제3자 제공에 동의한 것으로 간주됩니다.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex gap-2">
            <CustomButton
              type="button"
              variant="outline"
              className="cursor-pointer"
              disabled={isRedirecting}
              onClick={() => setIsConfirmDialogOpen(false)}
            >
              취소
            </CustomButton>
            <CustomButton
              type="button"
              className="cursor-pointer"
              disabled={pending || isPending || isRedirecting}
              isLoading={pending || isPending || isRedirecting}
              onClick={handleConfirmSignup}
            >
              계속
            </CustomButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Form>
  )
}
