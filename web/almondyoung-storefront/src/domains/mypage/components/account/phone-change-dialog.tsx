"use client"

import CustomPhoneInput from "@/components/shared/inputs/phone-input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useTwilio from "@/domains/payment/components/hooks/use-twilio"
import {
  formatPhoneNumber,
  getCleanKoreanNumber,
  toE164Korean,
} from "@/lib/utils/format-phone-number"
import { ChevronRight, Mail, MessageSquareText } from "lucide-react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { updatePhoneNumberAction } from "../actions/profile"
import { useEmailOtp } from "../hooks/use-email-otp"
import { OtpCodeInput } from "./otp-code-input"

// 현재 번호 본인확인(문자 또는 이메일 코드) → 새 번호 입력 → 새 번호 SMS 인증 → 저장
type Step = "intro" | "verifyCurrent" | "verifyCurrentEmail" | "input" | "verifyNew"

interface PhoneChangeDialogProps {
  phoneNumber: string | null
  email: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PhoneChangeDialog({
  phoneNumber,
  email,
  open,
  onOpenChange,
}: PhoneChangeDialogProps) {
  const t = useTranslations("mypage.account.accountInfo.phoneDialog")
  const tPhone = useTranslations("mypage.account.phone")
  const router = useRouter()

  const currentPhone = getCleanKoreanNumber(phoneNumber ?? "")
  // 등록된 번호가 없으면 본인확인 단계를 건너뛰고 바로 새 번호 입력
  const initialStep: Step = currentPhone ? "intro" : "input"

  const [step, setStep] = useState<Step>(initialStep)
  const [code, setCode] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [countryCode, setCountryCode] = useState("KR")
  const [isUpdating, startUpdateTransition] = useTransition()

  const {
    sendTwilioMessage,
    isCodeSendPending,
    isCodeSent,
    verifyCode,
    isCodeVerifyPending,
    isCodeVerified,
    timer,
    reset: resetTwilio,
  } = useTwilio()

  // 현재 번호 대신 이메일로 본인확인하는 대안 경로
  const emailOtp = useEmailOtp()

  const normalizedNewPhone = newPhone.replace(/\D/g, "")
  const isSameNumber =
    !!normalizedNewPhone && normalizedNewPhone === currentPhone
  // 코드 입력 단계에서 인증 대상이 되는 번호
  const targetPhone = step === "verifyNew" ? newPhone : currentPhone

  const resetAll = () => {
    setStep(initialStep)
    setCode("")
    setNewPhone("")
    resetTwilio()
    emailOtp.reset()
  }

  const handleOpenChange = (next: boolean) => {
    if (isUpdating) return
    onOpenChange(next)
    if (!next) resetAll()
  }

  // 발송 완료 → 코드 입력 단계로 전환
  useEffect(() => {
    if (!isCodeSent) return
    if (step === "intro") setStep("verifyCurrent")
    if (step === "input") setStep("verifyNew")
  }, [isCodeSent, step])

  // 이메일 코드 발송 완료 → 이메일 코드 입력 단계
  useEffect(() => {
    if (emailOtp.isCodeSent && step === "intro") setStep("verifyCurrentEmail")
  }, [emailOtp.isCodeSent, step])

  // 이메일 코드 본인확인 성공 → 새 번호 입력 단계
  useEffect(() => {
    if (emailOtp.isCodeVerified && step === "verifyCurrentEmail") {
      emailOtp.reset()
      setCode("")
      setStep("input")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailOtp.isCodeVerified, step])

  // 인증 성공 → 다음 단계 or 저장
  useEffect(() => {
    if (!isCodeVerified) return
    if (step === "verifyCurrent") {
      resetTwilio()
      setCode("")
      setStep("input")
      return
    }
    if (step === "verifyNew" && !isUpdating) {
      startUpdateTransition(async () => {
        try {
          const result = await updatePhoneNumberAction(newPhone)
          if (result.success) {
            toast.success(tPhone("changed"))
            onOpenChange(false)
            resetAll()
            router.refresh()
          } else {
            toast.error(result.error || tPhone("changeFailed"))
          }
        } catch (error: unknown) {
          const err = error as Error & { digest?: string }
          if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
            throw error
          }
          toast.error(tPhone("changeFailed"))
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCodeVerified, step])

  // twilio 엔드포인트는 E.164(+8210...) 형식만 허용
  const handleSendCode = (phone: string) => {
    sendTwilioMessage({
      countryCode: countryCode || "KR",
      phoneNumber: toE164Korean(phone),
      purpose: "phone_verify",
    })
  }

  const handleResend = () => {
    if (timer > 0) {
      toast.info(tPhone("resendCountdown", { timer }))
      return
    }
    setCode("")
    handleSendCode(targetPhone)
  }

  const handleSubmitCode = () => {
    if (code.length !== 6 || timer <= 0) return
    verifyCode({ phoneNumber: toE164Korean(targetPhone), code })
  }

  // 이메일 코드 경로 (현재 번호 대신 이메일로 본인확인)
  const handleSendEmailCode = () => {
    emailOtp.sendCode("phone_verify", { onError: (m) => toast.error(m) })
  }
  const handleResendEmail = () => {
    if (emailOtp.timer > 0) {
      toast.info(tPhone("resendCountdown", { timer: emailOtp.timer }))
      return
    }
    setCode("")
    handleSendEmailCode()
  }
  const handleSubmitEmailCode = () => {
    if (code.length !== 6 || emailOtp.timer <= 0) return
    emailOtp.verifyCode(code, "phone_verify", { onError: (m) => toast.error(m) })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === "intro" && (
          <>
            <DialogHeader className="pt-2">
              <DialogTitle className="text-xl">{t("introTitle")}</DialogTitle>
              <DialogDescription>{t("introDescription")}</DialogDescription>
            </DialogHeader>
            <div className="mt-2 flex flex-col gap-2">
              <button
                type="button"
                disabled={isCodeSendPending}
                onClick={() => handleSendCode(currentPhone)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg bg-gray-100 px-4 py-4 text-left transition-colors hover:bg-gray-200 disabled:opacity-60"
              >
                <MessageSquareText className="size-5 shrink-0 text-gray-600" />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">
                    {t("sendCodeSms")}
                  </span>
                  <span className="block text-sm text-gray-600">
                    {formatPhoneNumber(currentPhone)}
                  </span>
                </span>
                <ChevronRight className="size-4 text-gray-400" />
              </button>
              {email && (
                <button
                  type="button"
                  disabled={emailOtp.isCodeSendPending}
                  onClick={handleSendEmailCode}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-lg bg-gray-100 px-4 py-4 text-left transition-colors hover:bg-gray-200 disabled:opacity-60"
                >
                  <Mail className="size-5 shrink-0 text-gray-600" />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">
                      {t("sendCodeEmail")}
                    </span>
                    <span className="block break-all text-sm text-gray-600">
                      {email}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-gray-400" />
                </button>
              )}
            </div>
          </>
        )}

        {(step === "verifyCurrent" || step === "verifyNew") && (
          <>
            <DialogHeader className="items-center pt-2 text-center sm:text-center">
              <DialogTitle className="text-xl">{t("codeTitle")}</DialogTitle>
              <DialogDescription className="space-y-1 pt-1">
                <span className="text-foreground block break-all text-base font-semibold">
                  {formatPhoneNumber(getCleanKoreanNumber(targetPhone))}
                </span>
                <span className="text-muted-foreground block break-keep text-sm">
                  {t("codeSentHint")}
                </span>
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2 flex justify-center">
              <OtpCodeInput value={code} onChange={setCode} />
            </div>
            {timer <= 0 && (
              <p className="text-center text-xs text-red-500">
                {tPhone("expired")}
              </p>
            )}
            <div className="mt-2 flex flex-col gap-2">
              <Button
                type="button"
                className="h-11 w-full"
                disabled={
                  code.length !== 6 ||
                  isCodeVerifyPending ||
                  isUpdating ||
                  timer <= 0
                }
                onClick={handleSubmitCode}
              >
                {isCodeVerifyPending || isUpdating
                  ? tPhone("verifying")
                  : t("submit")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-11 w-full"
                disabled={isCodeSendPending}
                onClick={handleResend}
              >
                {t("resendCode")}
              </Button>
            </div>
          </>
        )}

        {step === "verifyCurrentEmail" && (
          <>
            <DialogHeader className="items-center pt-2 text-center sm:text-center">
              <DialogTitle className="text-xl">{t("codeTitle")}</DialogTitle>
              <DialogDescription className="space-y-1 pt-1">
                <span className="text-foreground block break-all text-base font-semibold">
                  {email}
                </span>
                <span className="text-muted-foreground block break-keep text-sm">
                  {t("codeSentHint")}
                </span>
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2 flex justify-center">
              <OtpCodeInput value={code} onChange={setCode} />
            </div>
            {emailOtp.timer <= 0 && (
              <p className="text-center text-xs text-red-500">
                {tPhone("expired")}
              </p>
            )}
            <div className="mt-2 flex flex-col gap-2">
              <Button
                type="button"
                className="h-11 w-full"
                disabled={
                  code.length !== 6 ||
                  emailOtp.isCodeVerifyPending ||
                  emailOtp.timer <= 0
                }
                onClick={handleSubmitEmailCode}
              >
                {emailOtp.isCodeVerifyPending ? tPhone("verifying") : t("submit")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-11 w-full"
                disabled={emailOtp.isCodeSendPending}
                onClick={handleResendEmail}
              >
                {t("resendCode")}
              </Button>
            </div>
          </>
        )}

        {step === "input" && (
          <>
            <DialogHeader className="pt-2">
              <DialogTitle className="text-xl">{t("changeTitle")}</DialogTitle>
              <DialogDescription>{t("changeDescription")}</DialogDescription>
            </DialogHeader>
            <div className="mt-2 space-y-3">
              <CustomPhoneInput
                className="h-12"
                value={newPhone}
                onChange={setNewPhone}
                onCountryChange={(country) => {
                  if (country) setCountryCode(country)
                }}
                countryCode={countryCode}
                placeholder={tPhone("newPhonePlaceholder")}
              />
              {isSameNumber && (
                <p className="text-xs text-amber-600">{tPhone("samePhone")}</p>
              )}
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  type="button"
                  className="h-11 w-full"
                  disabled={!newPhone || isCodeSendPending || isSameNumber}
                  onClick={() => handleSendCode(newPhone)}
                >
                  {isCodeSendPending ? tPhone("sending") : t("next")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-full"
                  onClick={() => handleOpenChange(false)}
                >
                  {tPhone("cancel")}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
