"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import CustomPhoneInput from "@/components/shared/inputs/phone-input"
import { Input } from "@/components/ui/input"
import { SignupSchema } from "domains/auth/schemas/signup-schema"
import useTwilio from "domains/payment/components/hooks/use-twilio"
import { useCallback, useEffect, useRef, useState } from "react"
import { Controller, UseFormReturn } from "react-hook-form"
import { toast } from "sonner"

interface PhoneVerificationFieldProps {
  form: UseFormReturn<SignupSchema>
}

export function PhoneVerificationField({ form }: PhoneVerificationFieldProps) {
  const verificationCodeRef = useRef<HTMLInputElement>(null)
  const [showVerifyStep, setShowVerifyStep] = useState(false)

  const {
    sendTwilioMessage,
    isCodeSendPending,
    isCodeSent,
    verifyCode,
    isCodeVerifyPending,
    isCodeVerified,
    timer,
  } = useTwilio()

  const phoneNumber = form.watch("phoneNumber")
  const verificationCode = form.watch("verificationCode")
  const countryCode = form.watch("countryCode")
  const isPhoneVerified = form.watch("isPhoneVerified")

  // 인증 성공 시 폼에 반영
  useEffect(() => {
    if (isCodeVerified && !isPhoneVerified) {
      form.setValue("isPhoneVerified", true)
      form.clearErrors("isPhoneVerified")
    }
  }, [isCodeVerified, isPhoneVerified, form])

  // 인증번호 발송 완료 감지 (isCodeSendPending: true → false 전환 시)
  const prevIsCodeSendPending = useRef(false)
  useEffect(() => {
    if (prevIsCodeSendPending.current && !isCodeSendPending && isCodeSent) {
      setShowVerifyStep(true)
    }
    prevIsCodeSendPending.current = isCodeSendPending
  }, [isCodeSendPending, isCodeSent])

  // 인증 입력 화면 전환 후 포커스
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
      phoneNumber,
      purpose: "phone_verify",
    })
  }, [form, phoneNumber, countryCode, sendTwilioMessage])

  const handleVerifyCode = useCallback(() => {
    if (verificationCode.length !== 6) return
    verifyCode({
      phoneNumber,
      code: verificationCode,
    })
  }, [verificationCode, phoneNumber, verifyCode])

  const handleChangeNumber = useCallback(() => {
    form.setValue("verificationCode", "")
    form.setValue("isPhoneVerified", false)
    setShowVerifyStep(false)
  }, [form])

  const handleResendCode = useCallback(() => {
    if (timer > 0) {
      toast.info(`${timer}초 후에 재전송할 수 있습니다.`)
      return
    }
    form.setValue("verificationCode", "")
    sendTwilioMessage({
      countryCode: countryCode || "KR",
      phoneNumber,
      purpose: "phone_verify",
    })
    verificationCodeRef.current?.focus()
  }, [timer, countryCode, phoneNumber, sendTwilioMessage, form])

  const handleResetAll = useCallback(() => {
    form.setValue("phoneNumber", "")
    form.setValue("verificationCode", "")
    form.setValue("isPhoneVerified", false)
    setShowVerifyStep(false)
  }, [form])

  // 인증 완료 상태
  if (isPhoneVerified) {
    return (
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          {phoneNumber} <span className="text-yellow-30">✓</span>
        </p>
        <button
          type="button"
          onClick={handleResetAll}
          className="text-muted-foreground hover:text-foreground text-xs underline transition-colors"
        >
          번호 변경
        </button>
      </div>
    )
  }

  // 인증번호 입력 화면
  if (showVerifyStep) {
    return (
      <div className="space-y-3">
        <div className="text-muted-foreground text-xs">
          {phoneNumber}으로 인증번호가 발송되었습니다.
        </div>

        <div className="flex items-center gap-2">
          <Controller
            name="verificationCode"
            control={form.control}
            render={({ field }) => (
              <Input
                ref={verificationCodeRef}
                type="text"
                placeholder="인증번호 6자리"
                maxLength={6}
                value={field.value}
                onChange={(e) =>
                  field.onChange(e.target.value.replace(/\D/g, ""))
                }
                className="font-mono tracking-widest"
              />
            )}
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

        {/* 에러 메시지 */}
        {form.formState.errors.isPhoneVerified && (
          <p className="text-xs text-red-500">
            {form.formState.errors.isPhoneVerified.message}
          </p>
        )}
      </div>
    )
  }

  // 번호 입력 화면
  return (
    <div className="space-y-4">
      {/* 휴대폰 번호 */}
      <Controller
        name="phoneNumber"
        control={form.control}
        render={({ field }) => (
          <CustomPhoneInput
            className="h-12"
            value={field.value}
            onChange={field.onChange}
            onCountryChange={(country) => {
              if (country) form.setValue("countryCode", country)
            }}
            countryCode={countryCode || "KR"}
            placeholder="010-0000-0000"
          />
        )}
      />

      <CustomButton
        type="button"
        size="sm"
        variant="outline"
        className="hover:bg-yellow-30 hover:text-background w-full cursor-pointer"
        disabled={isCodeSendPending}
        isLoading={isCodeSendPending}
        onClick={handleSendCode}
      >
        인증번호 받기
      </CustomButton>

      {/* 에러 메시지 */}
      {(form.formState.errors.phoneNumber ||
        form.formState.errors.isPhoneVerified) && (
        <p className="text-xs text-red-500">
          {form.formState.errors.phoneNumber?.message ||
            form.formState.errors.isPhoneVerified?.message}
        </p>
      )}
    </div>
  )
}
