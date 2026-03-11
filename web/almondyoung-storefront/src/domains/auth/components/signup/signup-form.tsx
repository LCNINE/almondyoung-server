"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import Link from "next/link"
import { Form } from "@/components/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { Cafe24SignupBootstrapData } from "@lib/api/users/auth/signup-cafe24"
import { createUser } from "@lib/api/users/auth/signup-base"
import { formatBirthday } from "@lib/utils/format-birthday"
import { toE164Korean } from "@lib/utils/format-phone-number"
import { signupSchema, SignupSchema } from "domains/auth/schemas/signup-schema"
import { setFormError } from "domains/auth/utils/set-form-error"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useActionState, useEffect, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { LegacyAccountMigrationCard } from "../legacy-account-migration-card"
import { SignupFormFields } from "./signup-form-fields"

export type SignupMode = "default" | "cafe24"

interface SignupFormProps {
  mode: SignupMode
  cafe24Bootstrap: Cafe24SignupBootstrapData | null
}

const normalizeBirthday = (value: string | null | undefined) =>
  value ? value.replace(/\D/g, "").slice(0, 8) : ""

const hasValue = (value: string | null | undefined) =>
  typeof value === "string" && value.trim().length > 0

const decodeLegacyMessage = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function SignupForm({ mode, cafe24Bootstrap }: SignupFormProps) {
  const router = useRouter()
  const { countryCode: rawCountryCode } = useParams() as {
    countryCode?: string
  }
  const searchParams = useSearchParams()
  const countryCode = rawCountryCode ?? "kr"
  const redirectTo = searchParams.get("redirect_to") || "/"
  const legacyStatus = searchParams.get("legacy_status")
  const legacyMessage = searchParams.get("legacy_message")
  const isCafe24Mode = mode === "cafe24"

  const prefill = cafe24Bootstrap?.prefill
  const prefillAvailable = !!cafe24Bootstrap?.prefillAvailable
  const hasIncompletePrefill =
    isCafe24Mode &&
    (!hasValue(prefill?.email) ||
      !hasValue(prefill?.username) ||
      !hasValue(prefill?.birthday) ||
      !hasValue(prefill?.phoneNumber))

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
      username: prefill?.username ?? "",
      nickname: "",
      email: prefill?.email ?? "",
      password: "",
      passwordConfirm: "",
      birthday: normalizeBirthday(prefill?.birthday),
      phoneNumber: toE164Korean(prefill?.phoneNumber ?? ""),
      verificationCode: "",
      countryCode: "KR",
      isPhoneVerified: isCafe24Mode,
      isOver14: false,
      termsOfService: false,
      electronicTransaction: false,
      privacyPolicy: false,
      thirdPartySharing: false,
      marketingConsent: false,
      encryptedIdToken: cafe24Bootstrap?.encryptedIdToken ?? "",
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

  useEffect(() => {
    if (!isCafe24Mode) return
    form.setValue("isPhoneVerified", true)
    form.clearErrors("isPhoneVerified")
  }, [isCafe24Mode, form])

  useEffect(() => {
    if (!legacyStatus && !legacyMessage) return

    if (legacyStatus === "ready") {
      toast.success("기존 아몬드영 정보를 불러왔습니다.")
    } else if (legacyStatus === "missing_token") {
      toast.error(
        legacyMessage
          ? decodeLegacyMessage(legacyMessage)
          : "기존 아몬드영 인증 토큰을 찾을 수 없습니다."
      )
    } else {
      toast.error(
        legacyMessage
          ? decodeLegacyMessage(legacyMessage)
          : "기존 아몬드영 정보를 불러오지 못했습니다."
      )
    }

    const params = new URLSearchParams(searchParams.toString())
    params.delete("legacy_status")
    params.delete("legacy_message")

    const nextQuery = params.toString()
    const nextPath = nextQuery
      ? `/${countryCode}/signup?${nextQuery}`
      : `/${countryCode}/signup`
    router.replace(nextPath)
  }, [countryCode, legacyMessage, legacyStatus, router, searchParams])

  const onSubmit = async (data: SignupSchema) => {
    const {
      passwordConfirm,
      verificationCode,
      countryCode,
      isPhoneVerified,
      encryptedIdToken,
      ...submitData
    } = data

    if (isCafe24Mode && !encryptedIdToken) {
      toast.error("기존 아몬드영 연동 토큰이 없습니다. 다시 시작해주세요.")
      return
    }

    const formattedBirthday = formatBirthday(submitData.birthday)
    const normalizedEncryptedIdToken = encryptedIdToken?.trim()

    const formattedSubmitData = {
      ...submitData,
      birthday: formattedBirthday,
      ...(normalizedEncryptedIdToken && {
        encryptedIdToken: normalizedEncryptedIdToken,
      }),
    }

    startTransition(() => {
      formAction(formattedSubmitData)
    })
  }

  const handleSignupClick = async () => {
    const shouldRequirePhoneVerification = !isCafe24Mode
    const isPhoneVerified = form.getValues("isPhoneVerified")

    if (shouldRequirePhoneVerification && !isPhoneVerified) {
      form.setError("isPhoneVerified", {
        type: "manual",
        message: "휴대폰 인증을 완료해주세요",
      })
    }

    const requiredFields: Array<keyof SignupSchema> = [
      "loginId",
      "username",
      "nickname",
      "email",
      "password",
      "passwordConfirm",
      "birthday",
      "phoneNumber",
    ]

    const isValid = await form.trigger(requiredFields)
    if (!isValid || (shouldRequirePhoneVerification && !isPhoneVerified)) return

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
        {!isCafe24Mode && (
          <div className="mb-2">
            <LegacyAccountMigrationCard variant="signup" />
          </div>
        )}

        <SignupFormFields
          form={form}
          mode={mode}
          prefillAvailable={prefillAvailable}
          hasIncompletePrefill={hasIncompletePrefill}
        />

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
            <p className="text-muted-foreground text-sm">
              가입을 계속하시면{" "}
              <Link
                href="/kr/terms"
                target="_blank"
                className="text-primary underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                이용약관
              </Link>
              ,{" "}
              <Link
                href="/kr/terms"
                target="_blank"
                className="text-primary underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                전자금융거래 약관
              </Link>
              ,{" "}
              <Link
                href="/kr/privacy"
                target="_blank"
                className="text-primary underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                개인정보 수집 및 이용
              </Link>
              ,{" "}
              <Link
                href="/kr/privacy"
                target="_blank"
                className="text-primary underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                개인정보 제3자 제공
              </Link>
              에 동의한 것으로 간주됩니다.
            </p>
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
