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
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import useTwilio from "@/domains/payment/components/hooks/use-twilio"
import { getMyProfile } from "@/lib/api/users/profile"
import { getCleanKoreanNumber } from "@/lib/utils/format-phone-number"
import { Check, Phone } from "lucide-react"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { updatePhoneNumberAction } from "../actions/profile"

type Step = "display" | "input" | "verify"

export function PhoneSection() {
  const [step, setStep] = useState<Step>("display")
  const [currentPhone, setCurrentPhone] = useState<string | null>(null)
  const [newPhone, setNewPhone] = useState("")
  const [countryCode, setCountryCode] = useState("KR")
  const [verificationCode, setVerificationCode] = useState("")
  const codeInputRef = useRef<HTMLInputElement>(null)
  const prevPending = useRef(false)
  const [isPending, startTransition] = useTransition()
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

  useEffect(() => {
    startTransition(async () => {
      try {
        const profile = await getMyProfile()
        setCurrentPhone(
          getCleanKoreanNumber(profile?.profile?.phoneNumber ?? "")
        )
      } catch {
        toast.error("전화번호를 불러오는데 실패했습니다.")
      }
    })
  }, [])

  const handleReset = useCallback(() => {
    setStep("display")
    setNewPhone("")
    setVerificationCode("")
    resetTwilio()
  }, [resetTwilio])

  const handleSendCode = useCallback(() => {
    if (!newPhone) {
      toast.error("휴대폰 번호를 입력해주세요.")
      return
    }
    if (isSameNumber) {
      toast.error("현재 번호와 동일한 번호입니다.")
      return
    }
    sendTwilioMessage({
      countryCode: countryCode || "KR",
      phoneNumber: newPhone,
      purpose: "phone_verify",
    })
  }, [newPhone, countryCode, sendTwilioMessage, isSameNumber])

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
      toast.info(`${timer}초 후에 재전송할 수 있습니다.`)
      return
    }
    setVerificationCode("")
    sendTwilioMessage({
      countryCode: countryCode || "KR",
      phoneNumber: newPhone,
      purpose: "phone_verify",
    })
    codeInputRef.current?.focus()
  }, [timer, countryCode, newPhone, sendTwilioMessage])

  useEffect(() => {
    if (step === "verify" && !isCodeVerified) {
      codeInputRef.current?.focus()
    }
  }, [step, isCodeVerified])

  const handleChangePhone = useCallback(() => {
    startUpdateTransition(async () => {
      try {
        const result = await updatePhoneNumberAction(newPhone)

        if (result.success) {
          toast.success("휴대폰 번호가 변경되었습니다.")
          setCurrentPhone(newPhone.replace(/\D/g, ""))
          handleReset()
        } else {
          toast.error(result.error || "휴대폰 번호 변경에 실패했습니다.")
        }
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error("휴대폰 번호 변경에 실패했습니다.")
      }
    })
  }, [newPhone, handleReset])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">휴대폰 번호</CardTitle>
        <CardDescription>
          휴대폰 번호 변경 시 SMS 인증이 필요합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === "display" && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-full bg-gray-100">
                <Phone className="size-4 text-gray-500" />
              </div>
              {isPending ? (
                <Skeleton className="h-5 w-28" />
              ) : (
                <span className="text-sm font-medium">{currentPhone}</span>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStep("input")}
              disabled={isPending}
            >
              번호 변경
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
              placeholder="새 휴대폰 번호"
            />
            {isSameNumber && (
              <p className="text-xs text-amber-600">
                현재 번호와 동일한 번호입니다.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReset}
              >
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!newPhone || isCodeSendPending || isSameNumber}
                onClick={handleSendCode}
              >
                {isCodeSendPending ? "발송 중..." : "인증번호 받기"}
              </Button>
            </div>
          </div>
        )}

        {step === "verify" && !isCodeVerified && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {newPhone}(으)로 인증번호가 발송되었습니다.
            </p>

            <div className="flex items-center gap-2">
              <Input
                ref={codeInputRef}
                type="text"
                placeholder="인증번호 6자리"
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
                {isCodeVerifyPending ? "확인 중..." : "인증하기"}
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-muted-foreground hover:text-foreground text-xs underline transition-colors"
                >
                  번호 변경
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={isCodeSendPending}
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

        {step === "verify" && isCodeVerified && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="grid size-5 place-items-center rounded-full bg-green-500">
                <Check className="size-3 text-white" strokeWidth={3} />
              </div>
              <p className="text-sm font-medium text-green-600">
                인증이 완료되었습니다.
              </p>
            </div>

            <p className="text-muted-foreground text-sm">
              {newPhone}(으)로 변경하시겠습니까?
            </p>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={isUpdating}
              >
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleChangePhone}
                disabled={isUpdating}
              >
                {isUpdating ? "변경 중..." : "번호 변경"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
