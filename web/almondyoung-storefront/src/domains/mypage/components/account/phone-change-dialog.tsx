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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import useTwilio from "@/domains/payment/components/hooks/use-twilio"
import {
  formatPhoneNumber,
  getCleanKoreanNumber,
  toE164Korean,
} from "@/lib/utils/format-phone-number"
import { ChevronRight, MessageSquareText } from "lucide-react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { updatePhoneNumberAction } from "../actions/profile"

// 현재 번호 SMS 인증(본인확인) → 새 번호 입력 → 새 번호 SMS 인증 → 저장
type Step = "intro" | "verifyCurrent" | "input" | "verifyNew"

interface PhoneChangeDialogProps {
  phoneNumber: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PhoneChangeDialog({
  phoneNumber,
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === "intro" && (
          <>
            <DialogHeader className="pt-2">
              <DialogTitle className="text-xl">{t("introTitle")}</DialogTitle>
              <DialogDescription>{t("introDescription")}</DialogDescription>
            </DialogHeader>
            <button
              type="button"
              disabled={isCodeSendPending}
              onClick={() => handleSendCode(currentPhone)}
              className="mt-2 flex w-full cursor-pointer items-center gap-3 rounded-lg bg-gray-100 px-4 py-4 text-left transition-colors hover:bg-gray-200 disabled:opacity-60"
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
          </>
        )}

        {(step === "verifyCurrent" || step === "verifyNew") && (
          <>
            <DialogHeader className="pt-2">
              <DialogTitle className="text-xl">{t("codeTitle")}</DialogTitle>
              <DialogDescription>
                {t("codeDescription", {
                  phone: formatPhoneNumber(getCleanKoreanNumber(targetPhone)),
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2 flex justify-center">
              <InputOTP maxLength={6} value={code} onChange={setCode}>
                <InputOTPGroup>
                  {Array.from({ length: 6 }, (_, i) => (
                    <InputOTPSlot key={i} index={i} className="size-11" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
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
