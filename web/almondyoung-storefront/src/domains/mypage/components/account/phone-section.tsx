"use client"

import CustomPhoneInput from "@/components/shared/inputs/phone-input"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import useTwilio from "@/domains/payment/components/hooks/use-twilio"
import { getCleanKoreanNumber } from "@/lib/utils/format-phone-number"
import { Phone } from "lucide-react"
import { useTranslations } from "next-intl"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { updatePhoneNumberAction } from "../actions/profile"

type Step = "display" | "input" | "verify"

interface PhoneSectionProps {
  initialPhoneNumber: string | null
}

export function PhoneSection({ initialPhoneNumber }: PhoneSectionProps) {
  const t = useTranslations("mypage.account.phone")
  const [step, setStep] = useState<Step>("display")
  const [currentPhone, setCurrentPhone] = useState<string>(
    getCleanKoreanNumber(initialPhoneNumber ?? "")
  )
  const [newPhone, setNewPhone] = useState("")
  const [countryCode, setCountryCode] = useState("KR")
  const [verificationCode, setVerificationCode] = useState("")
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const prevPending = useRef(false)
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
  const isSameNumber = normalizedNewPhone === currentPhone

  const handleReset = useCallback(() => {
    setStep("display")
    setNewPhone("")
    setVerificationCode("")
    setShowConfirmModal(false)
    resetTwilio()
  }, [resetTwilio])

  const handleSendCode = useCallback(() => {
    if (!newPhone) {
      toast.error(t("placeholder"))
      return
    }
    if (isSameNumber) {
      toast.error(t("samePhone"))
      return
    }
    sendTwilioMessage({
      countryCode: countryCode || "KR",
      phoneNumber: newPhone,
      purpose: "phone_verify",
    })
  }, [newPhone, countryCode, sendTwilioMessage, isSameNumber, t])

  useEffect(() => {
    if (prevPending.current && !isCodeSendPending && isCodeSent) {
      setStep("verify")
    }
    prevPending.current = isCodeSendPending
  }, [isCodeSendPending, isCodeSent])

  const handleVerifyCode = useCallback(() => {
    if (verificationCode.length !== 6 || timer <= 0) return
    verifyCode({ phoneNumber: newPhone, code: verificationCode })
  }, [verificationCode, newPhone, verifyCode, timer])

  const handleResend = useCallback(() => {
    if (timer > 0) {
      toast.info(t("resendCountdown", { timer }))
      return
    }
    setVerificationCode("")
    sendTwilioMessage({
      countryCode: countryCode || "KR",
      phoneNumber: newPhone,
      purpose: "phone_verify",
    })
    codeInputRef.current?.focus()
  }, [timer, countryCode, newPhone, sendTwilioMessage, t])

  useEffect(() => {
    if (step === "verify" && !isCodeVerified) {
      codeInputRef.current?.focus()
    }
  }, [step, isCodeVerified])

  useEffect(() => {
    if (isCodeVerified) {
      setShowConfirmModal(true)
    }
  }, [isCodeVerified])

  const handleChangePhone = useCallback(() => {
    startUpdateTransition(async () => {
      try {
        const result = await updatePhoneNumberAction(newPhone)

        if (result.success) {
          toast.success(t("changed"))
          setCurrentPhone(newPhone.replace(/\D/g, ""))
          setShowConfirmModal(false)
          handleReset()
        } else {
          toast.error(result.error || t("changeFailed"))
        }
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("changeFailed"))
      }
    })
  }, [newPhone, handleReset, t])

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === "display" && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-full bg-gray-100">
                  <Phone className="size-4 text-gray-500" />
                </div>
                <span className="text-sm font-medium">
                  {currentPhone || t("emptyPhone")}
                </span>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStep("input")}
              >
                {t("change")}
              </Button>
            </div>
          )}

          {step === "input" && (
            <div className="space-y-4">
              <CustomPhoneInput
                className="h-12"
                value={newPhone}
                onChange={setNewPhone}
                onCountryChange={(country) => {
                  if (country) setCountryCode(country)
                }}
                countryCode={countryCode}
                placeholder={t("newPhonePlaceholder")}
              />
              {isSameNumber && (
                <p className="text-xs text-amber-600">{t("samePhone")}</p>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!newPhone || isCodeSendPending || isSameNumber}
                  onClick={handleSendCode}
                >
                  {isCodeSendPending ? t("sending") : t("sendCode")}
                </Button>
              </div>
            </div>
          )}

          {step === "verify" && !isCodeVerified && (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">
                {t("codeSent", { phone: newPhone })}
              </p>

              <div className="flex items-center gap-2">
                <Input
                  ref={codeInputRef}
                  type="text"
                  placeholder={t("codePlaceholder")}
                  maxLength={6}
                  inputMode="numeric"
                  value={verificationCode}
                  onChange={(e) =>
                    setVerificationCode(e.target.value.replace(/\D/g, ""))
                  }
                  className="h-11 rounded-md border border-gray-300 px-4 font-mono tracking-widest"
                />
                <Button
                  type="button"
                  className="h-11 shrink-0 px-4"
                  disabled={
                    verificationCode.length !== 6 ||
                    isCodeVerifyPending ||
                    timer <= 0
                  }
                  onClick={handleVerifyCode}
                >
                  {isCodeVerifyPending ? t("verifying") : t("verify")}
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-muted-foreground hover:text-foreground text-xs underline transition-colors"
                  >
                    {t("change")}
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isCodeSendPending}
                    className="text-muted-foreground hover:text-foreground text-xs underline transition-colors disabled:opacity-50"
                  >
                    {t("resend")}
                  </button>
                </div>
                {timer > 0 ? (
                  <span className="font-mono text-xs text-red-500 tabular-nums">
                    {Math.floor(timer / 60)}:
                    {String(timer % 60).padStart(2, "0")}
                  </span>
                ) : (
                  <span className="text-xs text-red-500">{t("expired")}</span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={showConfirmModal}
        onOpenChange={(open) => {
          if (!isUpdating && !open) {
            setShowConfirmModal(false)
            setVerificationCode("")
            resetTwilio()
            setStep("input")
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("confirmModalTitle")}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-1 text-sm">
                <p>{t("verified")}</p>
                <p>{t("changeConfirm", { phone: newPhone })}</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowConfirmModal(false)
                setVerificationCode("")
                resetTwilio()
                setStep("input")
              }}
              disabled={isUpdating}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleChangePhone}
              disabled={isUpdating}
            >
              {isUpdating ? t("changing") : t("change")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
