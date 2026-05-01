"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import CustomPhoneInput from "@/components/shared/inputs/phone-input"
import { Spinner } from "@/components/shared/spinner"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
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
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import z from "zod"
import {
  formatPhone,
  getSendCountFromStorage,
  saveSendCountToStorage,
} from "./utils"

const findIdSchema = z.object({
  phoneNumber: z.string().min(1, "휴대폰 번호를 입력해주세요"),
})

type FindIdFormData = z.infer<typeof findIdSchema>

const SEND_COUNT_STORAGE_KEY = "find-id-sms-send"

export function AccountFindIdForm() {
  const { forgetUserId, isLoading } = useForgetUserId()
  const { countryCode } = useParams<{ countryCode: string }>()
  const [verificationCode, setVerificationCode] = useState("")
  const [showVerifyStep, setShowVerifyStep] = useState(false)
  const [verifiedPhoneNumber, setVerifiedPhoneNumber] = useState<string | null>(
    null
  )
  const [foundLoginIds, setFoundLoginIds] = useState<string[] | null>(null)
  const [isAutoFinding, setIsAutoFinding] = useState(false)
  const [hasRequestedId, setHasRequestedId] = useState(false)
  const [wasVerifyPending, setWasVerifyPending] = useState(false)

  const [sendCount, setSendCount] = useState(() => {
    if (typeof window === "undefined") return 0
    return getSendCountFromStorage(SEND_COUNT_STORAGE_KEY).count
  })
  const [sendCountResetTimer, setSendCountResetTimer] = useState(() => {
    if (typeof window === "undefined") return 0
    const { expiresAt } = getSendCountFromStorage(SEND_COUNT_STORAGE_KEY)
    if (!expiresAt) return 0
    const remaining = Math.ceil((expiresAt - Date.now()) / 1000)
    return remaining > 0 ? remaining : 0
  })

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

  const phoneNumber = form.watch("phoneNumber")

  // 재전송 카운터 리셋 타이머 + sessionStorage 동기화
  useEffect(() => {
    if (sendCountResetTimer <= 0) return
    const interval = setInterval(() => {
      setSendCountResetTimer((prev) => {
        if (prev <= 1) {
          setSendCount(0)
          sessionStorage.removeItem(SEND_COUNT_STORAGE_KEY)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [sendCountResetTimer])

  useEffect(() => {
    if (isCodeVerified) {
      setVerifiedPhoneNumber(phoneNumber)
    }
  }, [isCodeVerified, phoneNumber])

  useEffect(() => {
    if (verifiedPhoneNumber && phoneNumber !== verifiedPhoneNumber) {
      setVerificationCode("")
      setShowVerifyStep(false)
      setFoundLoginIds(null)
      setHasRequestedId(false)
    }
  }, [phoneNumber, verifiedPhoneNumber])

  useEffect(() => {
    if (isCodeSent && !isCodeSendPending) {
      setShowVerifyStep(true)
    }
  }, [isCodeSent, isCodeSendPending])

  // 검증 실패 시 OTP 입력값 초기화
  useEffect(() => {
    if (isCodeVerifyPending) {
      setWasVerifyPending(true)
    } else if (wasVerifyPending && !isCodeVerified) {
      setVerificationCode("")
      setWasVerifyPending(false)
    } else {
      setWasVerifyPending(false)
    }
  }, [isCodeVerifyPending, isCodeVerified, wasVerifyPending])

  const handleSendCode = useCallback(() => {
    if (!phoneNumber) {
      form.setError("phoneNumber", { message: "휴대폰 번호를 입력해주세요" })
      return
    }

    if (sendCount >= 3) {
      toast.error("1분 후 다시 시도해주세요.")
      return
    }

    sendTwilioMessage({
      countryCode: countryCode || "KR",
      phoneNumber,
      purpose: "phone_verify",
    })
    const newCount = sendCount + 1
    const expiresAt =
      sendCountResetTimer > 0
        ? Date.now() + sendCountResetTimer * 1000
        : Date.now() + 60_000
    setSendCount(newCount)
    saveSendCountToStorage(SEND_COUNT_STORAGE_KEY, newCount, expiresAt)
    if (sendCountResetTimer <= 0) {
      setSendCountResetTimer(60)
    }
  }, [
    form,
    phoneNumber,
    countryCode,
    sendTwilioMessage,
    sendCount,
    sendCountResetTimer,
  ])

  const handleVerifyCode = useCallback(
    (code: string) => {
      if (code.length !== 6) return
      verifyCode({
        phoneNumber,
        code,
      })
    },
    [verifyCode, phoneNumber]
  )

  const handleOTPChange = useCallback(
    (value: string) => {
      setVerificationCode(value)
      if (value.length === 6) {
        handleVerifyCode(value)
      }
    },
    [handleVerifyCode]
  )

  const handleChangeNumber = useCallback(() => {
    setVerificationCode("")
    setShowVerifyStep(false)
    setVerifiedPhoneNumber(null)
  }, [])

  const handleResendCode = useCallback(() => {
    if (sendCount >= 3) {
      toast.error("1분 후 다시 시도해주세요.")
      return
    }

    setVerificationCode("")
    sendTwilioMessage({
      countryCode: countryCode || "KR",
      phoneNumber,
      purpose: "phone_verify",
    })
    const newCount = sendCount + 1
    const expiresAt =
      sendCountResetTimer > 0
        ? Date.now() + sendCountResetTimer * 1000
        : Date.now() + 60_000
    setSendCount(newCount)
    saveSendCountToStorage(SEND_COUNT_STORAGE_KEY, newCount, expiresAt)
    if (sendCountResetTimer <= 0) {
      setSendCountResetTimer(60)
    }
  }, [
    countryCode,
    sendTwilioMessage,
    phoneNumber,
    sendCount,
    sendCountResetTimer,
  ])

  const isPhoneVerified = verifiedPhoneNumber === phoneNumber && isCodeVerified

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

    const result = await forgetUserId(phoneNumber)

    if (!result.success) {
      form.setError("phoneNumber", {
        message: result.error.message,
      })
      return
    }

    setFoundLoginIds(result.loginIds || [])
  }

  useEffect(() => {
    if (!isPhoneVerified || foundLoginIds || isAutoFinding || hasRequestedId)
      return

    const run = async () => {
      try {
        setIsAutoFinding(true)
        setHasRequestedId(true)
        await runFindId({ phoneNumber: phoneNumber })
      } finally {
        setIsAutoFinding(false)
      }
    }

    void run()
  }, [
    isPhoneVerified,
    foundLoginIds,
    isAutoFinding,
    phoneNumber,
    form,
    forgetUserId,
  ])

  return (
    <section className="flex min-h-lvh w-full max-w-[375px] flex-col justify-center px-4">
      {!foundLoginIds && !showVerifyStep && (
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold">아이디찾기</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            가입 시 등록한 휴대폰 번호로 아이디를 찾을 수 있습니다.
          </p>
        </div>
      )}

      <Form {...form}>
        <form
          onSubmit={(event) => event.preventDefault()}
          className="space-y-4"
        >
          {!foundLoginIds && !showVerifyStep && !isPhoneVerified && (
            <>
              <FormField
                control={form.control}
                name="phoneNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <CustomPhoneInput
                        className="h-12"
                        value={field.value}
                        onChange={field.onChange}
                        countryCode={countryCode || "KR"}
                        placeholder="010-0000-0000"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <CustomButton
                type="submit"
                size="sm"
                variant="fill"
                className="w-full cursor-pointer"
                disabled={isCodeSendPending || sendCount >= 3}
                isLoading={isCodeSendPending}
                onClick={handleSendCode}
              >
                인증번호 받기
              </CustomButton>
            </>
          )}

          {showVerifyStep && !isPhoneVerified && !foundLoginIds && (
            <div className="space-y-3">
              <p className="text-muted-foreground text-xs">
                {formatPhone(phoneNumber)}으로 인증번호가 발송되었습니다.
              </p>

              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={verificationCode}
                  onChange={handleOTPChange}
                  disabled={isCodeVerified || isCodeVerifyPending}
                  autoFocus
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {isCodeVerifyPending && (
                <div className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
                  <Spinner size="sm" />
                  인증 확인 중...
                </div>
              )}

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
                    disabled={isCodeSendPending || sendCount >= 3}
                    className="text-muted-foreground hover:text-foreground text-xs underline transition-colors disabled:opacity-50"
                  >
                    재전송
                    {sendCount > 0 && ` (남은 횟수: ${3 - sendCount}회)`}
                  </button>
                </div>
                <div className="text-right">
                  {sendCount >= 3 ? (
                    <span className="text-xs text-red-500">
                      1분 후 다시 시도해주세요
                    </span>
                  ) : timer > 0 ? (
                    <span className="font-mono text-xs text-red-500 tabular-nums">
                      {Math.floor(timer / 60)}:
                      {String(timer % 60).padStart(2, "0")}
                    </span>
                  ) : isCodeSent ? (
                    <span className="text-xs text-red-500">
                      인증시간이 만료되었습니다
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* 결과 표시 */}
          {isLoading || isAutoFinding ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-center text-xs">
                아이디 확인중...
              </p>
            </div>
          ) : foundLoginIds ? (
            <div className="rounded-lg p-4">
              <p className="text-center text-sm">
                <strong>아이디를 확인해주세요!</strong>
              </p>
              <p className="text-muted-foreground mt-2 text-center text-xs">
                아이디:{" "}
                <span className="font-semibold">
                  {foundLoginIds.join(", ")}
                </span>
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground text-center text-xs">
                가입 시 등록한 휴대폰 번호로 아이디를 찾을 수 있습니다.
              </p>
            </div>
          )}

          <div className="flex items-center justify-center gap-4">
            <LocalizedClientLink
              href="/login"
              className="text-muted-foreground hover:text-foreground text-xs underline transition-colors"
            >
              로그인 페이지로 이동
            </LocalizedClientLink>
            <LocalizedClientLink
              href="/find/password"
              className="text-muted-foreground hover:text-foreground text-xs underline transition-colors"
            >
              비밀번호 찾기
            </LocalizedClientLink>
          </div>
        </form>
      </Form>
    </section>
  )
}
