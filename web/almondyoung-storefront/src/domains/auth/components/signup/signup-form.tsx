"use client"

import { CustomButton } from "@components/common/custom-buttons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@components/common/ui/dialog"
import { Form } from "@components/common/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { createUser } from "@lib/api/users/auth/signup-base"
import { signupSchema, SignupSchema } from "domains/auth/schemas/signup-schema"
import { useSearchParams } from "next/navigation"
import { useActionState, useEffect, useState, useTransition } from "react"
import { useForm, useFormContext } from "react-hook-form"
import { toast } from "sonner"
import { AgreementsSection } from "./agreement"
import { SignupFormFields } from "./signup-form-fields"
import { formatBirthday } from "@lib/utils/format-birthday"

export function SignupForm() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect_to") || undefined

  const [state, formAction, pending] = useActionState(createUser, null)
  const [isPending, startTransition] = useTransition()

  const [isAgreementsDialogOpen, setIsAgreementsDialogOpen] =
    useState<boolean>(false)

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
      birthday: "",
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
        setIsAgreementsDialogOpen(false) // 약관 모달 닫기
      }
    }
  }, [state])

  const onSubmit = async (data: SignupSchema) => {
    const { passwordConfirm, ...submitData } = data
    const formattedBirthday = formatBirthday(submitData.birthday)

    const formattedSubmitData = {
      ...submitData,
      birthday: formattedBirthday,
    }

    // 약관 동의 모달 열려있으면 닫기
    if (isAgreementsDialogOpen) setIsAgreementsDialogOpen(false)

    startTransition(() => {
      formAction({
        ...formattedSubmitData,
        redirectTo,
      })
    })
  }

  const handleAgreementsDialogOpen = async () => {
    // 회원 정보 필드들만 검증
    const isValid = await form.trigger([
      "loginId",
      "username",
      "nickname",
      "email",
      "password",
      "passwordConfirm",
      "birthday",
    ])

    // 검증 통과하면 다이얼로그 열기
    if (isValid) {
      setIsAgreementsDialogOpen(!isAgreementsDialogOpen)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex w-full flex-col gap-4"
        id="signup-form"
      >
        {/* 회원 정보 입력 필드들 */}
        <SignupFormFields form={form} />

        {!state ? (
          <div className="ml-auto">
            {/* 동의 약관 온오프 다이얼로그 */}
            <AgreementsDialogBtn
              isOpen={isAgreementsDialogOpen}
              onOpen={handleAgreementsDialogOpen}
              isPending={isPending}
              buttonText="동의하고 가입하기"
            />
          </div>
        ) : (
          <div className="ml-auto">
            {/* 동의 약관 온오프 다이얼로그 */}
            <AgreementsDialogBtn
              isOpen={isAgreementsDialogOpen}
              onOpen={handleAgreementsDialogOpen}
              isPending={isPending}
              buttonText="동의 약관 보기"
              variant="link"
            />

            {/* 제출 버튼 */}
            <CustomButton
              type="submit"
              disabled={!form.formState.isValid || pending || isPending}
              isLoading={pending || isPending}
              className="cursor-pointer"
            >
              가입하기
            </CustomButton>
          </div>
        )}
      </form>
    </Form>
  )
}

function AgreementsDialogBtn({
  isOpen,
  onOpen,
  isPending,
  buttonText,
  className,
  variant = "fill",
}: {
  isOpen: boolean
  onOpen: () => void
  isPending: boolean
  buttonText: string
  className?: string
  variant?: "fill" | "outline" | "ghost" | "link"
}) {
  const form = useFormContext<SignupSchema>()

  return (
    <Dialog open={isOpen} onOpenChange={onOpen}>
      <DialogTrigger asChild>
        <CustomButton
          type="button"
          variant={variant}
          className={`${className} cursor-pointer`}
        >
          {buttonText}
        </CustomButton>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>약관 동의</DialogTitle>{" "}
        </DialogHeader>
        <DialogDescription className="sr-only">
          아래 내용을 자세히 읽어보시고 동의해 주세요.
        </DialogDescription>

        <AgreementsSection form={form} />

        <DialogFooter>
          <CustomButton
            type="submit"
            className="cursor-pointer"
            disabled={isPending}
            isLoading={isPending}
            form="signup-form"
          >
            가입하기
          </CustomButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
