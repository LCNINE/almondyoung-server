"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
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
import { useForgetUserId } from "domains/auth/hooks/use-forget-userid"
import useTwilio from "domains/payment/components/hooks/use-twilio"
import { useParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { useCallback, useEffect, useRef, useState } from "react"
import z from "zod"

const findIdSchema = z.object({
  phoneNumber: z.string().min(1, "휴대폰 번호를 입력해주세요"),
})

type FindIdFormData = z.infer<typeof findIdSchema>

export function AccountFindIdForm() {
  const { forgetUserId, isLoading } = useForgetUserId()
  const { countryCode } = useParams<{ countryCode: string }>()
  const verificationCodeRef = useRef<HTMLInputElement>(null)
  const [verificationCode, setVerificationCode] = useState("")
  const [showVerifyStep, setShowVerifyStep] = useState(false)
  const [verifiedPhoneNumber, setVerifiedPhoneNumber] = useState<string | null>(
    null
  )
  const [foundLoginId, setFoundLoginId] = useState<string | null>(null)
  const [isAutoFinding, setIsAutoFinding] = useState(false)
  const [hasRequestedId, setHasRequestedId] = useState(false)

  const {
    sendTwilioMessage,
    isCodeSendPending,
    isCodeSent,
    verifyCode,
    isCodeVerifyPending,
    isCodeVerified,
    timer,
  } = useTwilio()

  const form = useForm<FindIdFormData>({
    resolver: zodResolver(findIdSchema),
    mode: "onChange",
    defaultValues: {
      phoneNumber: "",
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

  useEffect(() => {
    if (isCodeVerified) {
      setVerifiedPhoneNumber(normalizedPhoneNumber)
    }
  }, [isCodeVerified, normalizedPhoneNumber])

  useEffect(() => {
    if (verifiedPhoneNumber && phoneNumber !== verifiedPhoneNumber) {
      setVerificationCode("")
      setShowVerifyStep(false)
      setFoundLoginId(null)
      setHasRequestedId(false)
    }
  }, [phoneNumber, verifiedPhoneNumber])

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
    if (timer === 0 && isPhoneVerified) {
      setVerifiedPhoneNumber(null)
      setVerificationCode("")
      setShowVerifyStep(false)
    }
  }, [timer, isPhoneVerified])

  const runFindId = async (data: FindIdFormData) => {
    if (!isPhoneVerified) {
      form.setError("phoneNumber", {
        message: "휴대폰 인증을 완료해주세요",
      })
      return
    }

    const result = await forgetUserId(normalizedPhoneNumber)

    if (!result.success) {
      form.setError("phoneNumber", {
        message: result.error.message,
      })
      return
    }

    setFoundLoginId(result.loginId ?? null)
  }

  useEffect(() => {
    if (!isPhoneVerified || foundLoginId || isAutoFinding || hasRequestedId)
      return

    const run = async () => {
      try {
        setIsAutoFinding(true)
        setHasRequestedId(true)
        await runFindId({ phoneNumber: normalizedPhoneNumber })
      } finally {
        setIsAutoFinding(false)
      }
    }

    void run()
  }, [isPhoneVerified, foundLoginId, isAutoFinding, phoneNumber, form, forgetUserId])

  return (
    <section className="flex min-h-lvh w-full max-w-[375px] flex-col justify-center px-4">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold">아이디찾기</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          가입 시 등록한 휴대폰 번호로 아이디를 찾을 수 있습니다.
        </p>
      </div>

      <Form {...form}>
        <form
          onSubmit={(event) => event.preventDefault()}
          className="space-y-4"
        >
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

          {!showVerifyStep && !isPhoneVerified && (
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

          {showVerifyStep && !isPhoneVerified && (
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

          {/* 안내 문구 */}
          {isLoading || isAutoFinding ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-center text-xs">
                아이디 확인중...
              </p>
            </div>
          ) : foundLoginId ? (
            <div className="rounded-lg p-4">
              <p className="text-center text-sm">
                <strong>아이디를 확인해주세요!</strong>
              </p>
              <p className="text-muted-foreground mt-2 text-center text-xs">
                아이디: <span className="font-semibold">{foundLoginId}</span>
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground text-center text-xs">
                가입 시 등록한 휴대폰 번호로 아이디를 찾을 수 있습니다.
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
