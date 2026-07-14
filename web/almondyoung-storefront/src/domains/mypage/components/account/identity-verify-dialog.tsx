"use client"

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
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { OtpCodeInput } from "./otp-code-input"
import { useEmailOtp } from "../hooks/use-email-otp"

type Channel = "sms" | "email"
type Step = "intro" | "code"

interface IdentityVerifyDialogProps {
  phoneNumber: string | null
  email: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 문자/이메일 코드 중 하나로 본인확인이 끝나면 호출 (예: 비밀번호 페이지로 이동) */
  onVerified: () => void
}

// 비밀번호 변경 등 민감 작업 전 본인확인 게이트.
// 문자(SMS) 또는 이메일 코드 중 하나를 통과하면 onVerified 호출.
// 서버는 purpose='password_change' 로 검증 기록을 남기고, 비밀번호 페이지가 이를 확인해 URL 직접 접근을 차단한다.
export function IdentityVerifyDialog({
  phoneNumber,
  email,
  open,
  onOpenChange,
  onVerified,
}: IdentityVerifyDialogProps) {
  const t = useTranslations("mypage.account.accountInfo.gateDialog")
  const currentPhone = getCleanKoreanNumber(phoneNumber ?? "")

  const [step, setStep] = useState<Step>("intro")
  const [channel, setChannel] = useState<Channel | null>(null)
  const [code, setCode] = useState("")

  const sms = useTwilio()
  const emailOtp = useEmailOtp()

  const active = channel === "email" ? emailOtp : sms
  const isSent = channel === "email" ? emailOtp.isCodeSent : sms.isCodeSent
  const isVerified =
    channel === "email" ? emailOtp.isCodeVerified : sms.isCodeVerified
  const timer = active.timer

  const resetAll = () => {
    setStep("intro")
    setChannel(null)
    setCode("")
    sms.reset()
    emailOtp.reset()
  }

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next)
    if (!next) resetAll()
  }

  // 코드 발송 완료 → 코드 입력 단계
  useEffect(() => {
    if (isSent) setStep("code")
  }, [isSent])

  // 검증 성공 → 부모에 통지
  useEffect(() => {
    if (isVerified) onVerified()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVerified])

  const sendSms = () => {
    sms.sendTwilioMessage({
      countryCode: "KR",
      phoneNumber: toE164Korean(currentPhone),
      purpose: "password_change",
    })
  }
  const sendEmail = () => {
    emailOtp.sendCode("password_change", { onError: (m) => toast.error(m) })
  }

  const chooseSms = () => {
    if (!currentPhone) {
      toast.error(t("noPhone"))
      return
    }
    setChannel("sms")
    sendSms()
  }
  const chooseEmail = () => {
    setChannel("email")
    sendEmail()
  }

  const handleResend = () => {
    if (timer > 0) {
      toast.info(t("resendCountdown", { timer }))
      return
    }
    setCode("")
    if (channel === "sms") sendSms()
    else sendEmail()
  }

  const handleSubmit = () => {
    if (code.length !== 6 || timer <= 0) return
    if (channel === "sms") {
      sms.verifyCode({ phoneNumber: toE164Korean(currentPhone), code })
    } else {
      emailOtp.verifyCode(code, "password_change", {
        onError: (m) => toast.error(m),
      })
    }
  }

  const optionClass =
    "flex w-full cursor-pointer items-center gap-3 rounded-lg bg-gray-100 px-4 py-4 text-left transition-colors hover:bg-gray-200 disabled:opacity-60"

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === "intro" ? (
          <>
            <DialogHeader className="pt-2">
              <DialogTitle className="text-xl">{t("introTitle")}</DialogTitle>
              <DialogDescription>{t("introDescription")}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 mt-2">
              {currentPhone && (
                <button
                  type="button"
                  disabled={sms.isCodeSendPending}
                  onClick={chooseSms}
                  className={optionClass}
                >
                  <MessageSquareText className="text-gray-600 size-5 shrink-0" />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">
                      {t("sendCodeSms")}
                    </span>
                    <span className="block text-sm text-gray-600">
                      {formatPhoneNumber(currentPhone)}
                    </span>
                  </span>
                  <ChevronRight className="text-gray-400 size-4" />
                </button>
              )}
              {email && (
                <button
                  type="button"
                  disabled={emailOtp.isCodeSendPending}
                  onClick={chooseEmail}
                  className={optionClass}
                >
                  <Mail className="text-gray-600 size-5 shrink-0" />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">
                      {t("sendCodeEmail")}
                    </span>
                    <span className="block text-sm text-gray-600 break-all">
                      {email}
                    </span>
                  </span>
                  <ChevronRight className="text-gray-400 size-4" />
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="items-center pt-2 text-center sm:text-center">
              <DialogTitle className="text-xl">{t("codeTitle")}</DialogTitle>
              <DialogDescription className="pt-1 space-y-1">
                <span className="block text-base font-semibold break-all text-foreground">
                  {channel === "email"
                    ? email
                    : formatPhoneNumber(currentPhone)}
                </span>
                <span className="block text-sm text-muted-foreground break-keep">
                  {t("codeSentHint")}
                </span>
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-center mt-2">
              <OtpCodeInput value={code} onChange={setCode} />
            </div>
            {timer <= 0 && (
              <p className="text-xs text-center text-red-500">{t("expired")}</p>
            )}
            <div className="flex flex-col gap-2 mt-2">
              <Button
                type="button"
                className="w-full h-11"
                disabled={
                  code.length !== 6 ||
                  active.isCodeSendPending ||
                  active.isCodeVerifyPending ||
                  timer <= 0
                }
                onClick={handleSubmit}
              >
                {active.isCodeVerifyPending ? t("verifying") : t("submit")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full h-11"
                disabled={active.isCodeSendPending}
                onClick={handleResend}
              >
                {t("resendCode")}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
