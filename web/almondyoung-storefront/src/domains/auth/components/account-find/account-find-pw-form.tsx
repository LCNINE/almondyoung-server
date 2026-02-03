"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import { CustomInput } from "@/components/shared/inputs/custom-input"
import CustomPhoneInput from "@/components/shared/inputs/phone-input"
import { Spinner } from "@/components/shared/spinner"
import { Input } from "@/components/ui/input"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@components/common/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { resetPassword } from "@lib/api/users/forgot/reset-password"
import { useForgetPw } from "domains/auth/hooks/use-forget-pw"
import useTwilio from "domains/payment/components/hooks/use-twilio"
import { IdCardLanyard, Mail } from "lucide-react"
import { useParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import z from "zod"

const findPwSchema = z.object({
  loginId: z.string().min(1, "아이디를 입력해주세요"),
  phoneNumber: z.string().min(1, "휴대폰 번호를 입력해주세요"),
  password: z.string().optional(),
  passwordConfirm: z.string().optional(),
})

type FindPwFormData = z.infer<typeof findPwSchema>

export function AccountFindPwForm() {
  const { forgetPw, isLoading } = useForgetPw()
  const { countryCode } = useParams<{ countryCode: string }>()
  const verificationCodeRef = useRef<HTMLInputElement>(null)
  const [verificationCode, setVerificationCode] = useState("")
  const [showVerifyStep, setShowVerifyStep] = useState(false)
  const [verifiedPhoneNumber, setVerifiedPhoneNumber] = useState<string | null>(
    null
  )
  const [verifiedLoginId, setVerifiedLoginId] = useState<string | null>(null)
  const [verificationToken, setVerificationToken] = useState<string | null>(
    null
  )
  const [isResetting, setIsResetting] = useState(false)

  const {
    sendTwilioMessage,
    isCodeSendPending,
    isCodeSent,
    verifyCode,
    isCodeVerifyPending,
    isCodeVerified,
    timer,
  } = useTwilio()

  const form = useForm<FindPwFormData>({
    resolver: zodResolver(findPwSchema),
    mode: "onChange",
    defaultValues: {
      loginId: "",
      phoneNumber: "",
      password: "",
      passwordConfirm: "",
    },
  })

  const normalizePhoneNumber = useCallback(
    (value: string) => {
      if (!value) return ""
      if (value.startsWith("+")) return value
      const digits = value.replace(/\D/g, "")
      if (digits.startsWith("82")) return `+${digits}`
      if (countryCode === "KR" && digits.startsWith("0")) {
        return `+82${digits.slice(1)}`
      }
      return digits
    },
    [countryCode]
  )

  const phoneNumber = form.watch("phoneNumber")
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber)
  const loginId = form.watch("loginId")

  useEffect(() => {
    if (isCodeVerified) {
      setVerifiedPhoneNumber(normalizedPhoneNumber)
    }
  }, [isCodeVerified, normalizedPhoneNumber])

  useEffect(() => {
    if (verifiedPhoneNumber && phoneNumber !== verifiedPhoneNumber) {
      setVerificationCode("")
      setShowVerifyStep(false)
    }
  }, [phoneNumber, verifiedPhoneNumber])

  useEffect(() => {
    if (
      verificationToken &&
      (phoneNumber !== verifiedPhoneNumber || loginId !== verifiedLoginId)
    ) {
      setVerificationToken(null)
      form.setValue("password", "")
      form.setValue("passwordConfirm", "")
    }
  }, [phoneNumber, loginId, verifiedPhoneNumber, verifiedLoginId, verificationToken, form])

  useEffect(() => {
    if (isCodeSent && !isCodeSendPending) {
      setShowVerifyStep(true)
    }
  }, [isCodeSent, isCodeSendPending])

  useEffect(() => {
    if (showVerifyStep && !isCodeVerified) {
      verificationCodeRef.current?.focus()
    }
  }, [showVerifyStep, isCodeVerified])

  const handleSendCode = useCallback(() => {
    if (!phoneNumber) {
      form.setError("phoneNumber", { message: "휴대폰 번호를 입력해주세요" })
      return
    }

    sendTwilioMessage({
      countryCode: countryCode || "KR",
      phoneNumber: normalizedPhoneNumber,
      purpose: "phone_verify",
    })
  }, [form, phoneNumber, countryCode, sendTwilioMessage, normalizedPhoneNumber])

  const handleVerifyCode = useCallback(() => {
    if (verificationCode.length !== 6) return
    verifyCode({
      phoneNumber: normalizedPhoneNumber,
      code: verificationCode,
    })
  }, [verificationCode, verifyCode, normalizedPhoneNumber])

  const handleChangeNumber = useCallback(() => {
    setVerificationCode("")
    setShowVerifyStep(false)
    setVerifiedPhoneNumber(null)
  }, [])

  const handleResendCode = useCallback(() => {
    if (timer > 0) return
    setVerificationCode("")
    sendTwilioMessage({
      countryCode: countryCode || "KR",
      phoneNumber: normalizedPhoneNumber,
      purpose: "phone_verify",
    })
    verificationCodeRef.current?.focus()
  }, [timer, countryCode, sendTwilioMessage, normalizedPhoneNumber])

  const isPhoneVerified =
    verifiedPhoneNumber === normalizedPhoneNumber && isCodeVerified

  useEffect(() => {
    if (timer === 0 && isPhoneVerified && !verificationToken) {
      setVerifiedPhoneNumber(null)
      setVerificationCode("")
      setShowVerifyStep(false)
    }
  }, [timer, isPhoneVerified, verificationToken])

  const onSubmit = async (data: FindPwFormData) => {
    if (!isPhoneVerified) {
      form.setError("phoneNumber", {
        message: "휴대폰 인증을 완료해주세요",
      })
      return
    }

    const result = await forgetPw(normalizedPhoneNumber, data.loginId)

    if (!result.success) {
      if (
        result.error.message.includes("휴대폰") ||
        result.error.message.includes("아이디")
      ) {
        form.setError("root", {
          message: "입력하신 정보가 일치하지 않습니다.",
        })
      } else {
        form.setError("root", {
          message: "오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        })
      }
      return
    }

    setVerificationToken(result.verificationToken ?? null)
    setVerifiedLoginId(data.loginId)
  }

  const handleResetPassword = async () => {
    if (!verificationToken) return

    const password = form.getValues("password") || ""
    const passwordConfirm = form.getValues("passwordConfirm") || ""

    if (password.length < 8) {
      form.setError("password", {
        message: "비밀번호는 8자 이상이어야 합니다.",
      })
      return
    }

    if (password !== passwordConfirm) {
      form.setError("passwordConfirm", {
        message: "비밀번호가 일치하지 않습니다.",
      })
      return
    }

    setIsResetting(true)
    const result = await resetPassword(verificationToken, password)
    if ("data" in result) {
      toast.success("비밀번호가 변경되었습니다. 다시 로그인해주세요.")
      setVerificationToken(null)
      form.setValue("password", "")
      form.setValue("passwordConfirm", "")
    } else {
      toast.error(result.error.message || "비밀번호 변경에 실패했습니다.")
    }
    setIsResetting(false)
  }

  return (
    <section className="flex min-h-lvh w-full max-w-[375px] flex-col justify-center px-4">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold">비밀번호찾기</h2>
        <p className="text-muted-foreground mt-2 text-sm tracking-tighter">
          가입 시 등록한 휴대폰 번호로 비밀번호를 재설정할 수 있습니다.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="phoneNumber"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <div className="relative">
                    <CustomPhoneInput
                      className="h-12"
                      value={field.value}
                      onChange={field.onChange}
                      countryCode={countryCode || "KR"}
                      placeholder="010-0000-0000"
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {!showVerifyStep && !isPhoneVerified && !verificationToken && (
            <CustomButton
              type="button"
              size="sm"
              variant="outline"
              className="w-full cursor-pointer"
              disabled={isCodeSendPending}
              isLoading={isCodeSendPending}
              onClick={handleSendCode}
            >
              인증번호 받기
            </CustomButton>
          )}

          {showVerifyStep && !isPhoneVerified && !verificationToken && (
            <div className="space-y-3">
              <div className="text-muted-foreground text-xs">
                {phoneNumber}으로 인증번호가 발송되었습니다.
              </div>

              <div className="flex items-center gap-2">
                <Input
                  ref={verificationCodeRef}
                  type="text"
                  placeholder="인증번호 6자리"
                  maxLength={6}
                  value={verificationCode}
                  onChange={(e) =>
                    setVerificationCode(e.target.value.replace(/\D/g, ""))
                  }
                  className="font-mono tracking-widest"
                />
                <CustomButton
                  type="button"
                  size="sm"
                  className="shrink-0 cursor-pointer"
                  disabled={verificationCode.length !== 6 || isCodeVerifyPending}
                  isLoading={isCodeVerifyPending}
                  onClick={handleVerifyCode}
                >
                  인증하기
                </CustomButton>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleChangeNumber}
                    className="text-muted-foreground hover:text-foreground text-xs underline transition-colors"
                  >
                    번호 변경
                  </button>
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={isCodeSendPending || timer > 0}
                    className="text-muted-foreground hover:text-foreground text-xs underline transition-colors disabled:opacity-50"
                  >
                    재전송
                  </button>
                </div>
                {timer > 0 ? (
                  <span className="font-mono text-xs text-red-500 tabular-nums">
                    {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, "0")}
                  </span>
                ) : (
                  <span className="text-xs text-red-500">
                    인증시간이 만료되었습니다
                  </span>
                )}
              </div>
            </div>
          )}

          <FormField
            control={form.control}
            name="loginId"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <div className="relative">
                  <CustomInput
                    {...field}
                    label="아이디"
                    disabled={isLoading || !!verificationToken}
                    autoComplete="username"
                    className="pr-10"
                    hasValue={!!field.value}
                    onClear={() => form.setValue("loginId", "")}
                    error={!!form.formState.errors.loginId}
                    icon={
                      <IdCardLanyard className="text-muted-foreground h-4 w-4" />
                    }
                  />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {verificationToken && (
            <>
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="relative">
                        <CustomInput
                          {...field}
                          type="password"
                          label="새 비밀번호"
                          disabled={isResetting}
                          className="pr-10"
                          hasValue={!!field.value}
                          onClear={() => form.setValue("password", "")}
                          error={!!form.formState.errors.password}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="passwordConfirm"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="relative">
                        <CustomInput
                          {...field}
                          type="password"
                          label="비밀번호 확인"
                          disabled={isResetting}
                          className="pr-10"
                          hasValue={!!field.value}
                          onClear={() => form.setValue("passwordConfirm", "")}
                          error={!!form.formState.errors.passwordConfirm}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          {/* 제출 버튼 */}
          {verificationToken ? (
            <CustomButton
              type="button"
              className="w-full"
              disabled={isResetting}
              size="lg"
              onClick={handleResetPassword}
            >
              {isResetting ? (
                <Spinner size="sm" color="white" />
              ) : (
                <>비밀번호 변경</>
              )}
            </CustomButton>
          ) : (
            <CustomButton
              type="submit"
              className="w-full"
              disabled={isLoading || !isPhoneVerified}
              size="lg"
            >
              {isLoading ? (
                <Spinner size="sm" color="white" />
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  비밀번호 찾기
                </>
              )}
            </CustomButton>
          )}

          {form.formState.errors.root && (
            <p className="mt-2 text-center text-sm text-red-500">
              {form.formState.errors.root.message}
            </p>
          )}

          {/* 안내 문구 */}
          {isLoading ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-center text-xs">
                요청 처리중...
              </p>
            </div>
          ) : verificationToken ? (
            <div className="rounded-lg p-4">
              <p className="text-center text-sm">
                <strong>새 비밀번호를 설정해주세요!</strong>
              </p>
              <p className="text-muted-foreground mt-2 text-center text-xs">
                인증이 완료되었습니다. 새 비밀번호를 입력해주세요.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground text-center text-xs">
                가입 시 등록한 휴대폰 번호로 인증번호를 전송해드립니다.
              </p>
            </div>
          )}

          <LocalizedClientLink
            href="/login"
            className="text-muted-foreground hover:text-foreground mt-4 block text-center text-xs underline transition-colors"
          >
            로그인 페이지로 이동
          </LocalizedClientLink>
        </form>
      </Form>
    </section>
  )
}
