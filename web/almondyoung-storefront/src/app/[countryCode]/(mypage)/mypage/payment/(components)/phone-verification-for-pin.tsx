"use client"

import { Button } from "@components/common/ui/button"
import { Form } from "@components/common/ui/form"
import { Input } from "@components/common/ui/input"
import { Label } from "@components/common/ui/label"
import CustomPhoneInput from "@/components/shared/inputs/phone-input"
import { updateProfile } from "@lib/api/users/profile"
import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import useTwilio from "domains/payment/components/hooks/use-twilio"
import { forgetPinSchema, type ForgetPinSchema } from "domains/payment/components/forget-pin/schema"
import PinSetupForm from "domains/payment/components/security-pin/pin-setup-form"

export default function PhoneVerificationForPin({
  redirectTo,
}: {
  redirectTo: string
}) {
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<ForgetPinSchema>({
    resolver: zodResolver(forgetPinSchema),
    mode: "onChange",
    defaultValues: {
      phoneNumber: "",
      verificationCode: "",
      step: "phone",
      countryCode: "KR",
      purpose: "phone_verify",
    },
  })

  const step = form.watch("step")
  const phoneNumber = form.watch("phoneNumber")
  const verificationCode = form.watch("verificationCode")
  const countryCode = form.watch("countryCode")

  const { sendTwilioMessage, verifyCode } = useTwilio()

  const handleSubmit = async (data: ForgetPinSchema) => {
    if (step === "phone") {
      setIsLoading(true)
      try {
        await sendTwilioMessage({
          countryCode: data.countryCode,
          phoneNumber: data.phoneNumber,
          purpose: "phone_verify",
        })

        form.setValue("verificationCode", "")
        toast.success("인증번호가 발송되었습니다")

        setTimeout(() => {
          setIsLoading(false)
          form.setValue("step", "verify")
        }, 1000)
      } catch (error) {
        console.error("Failed to send code:", error)
        toast.error("인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.")
        setIsLoading(false)
      }
    } else if (step === "verify") {
      setIsLoading(true)
      try {
        await verifyCode({
          phoneNumber: data.phoneNumber,
          code: data.verificationCode,
        })

        // 전화번호를 프로필에 저장
        await updateProfile({ phoneNumber: data.phoneNumber })

        setTimeout(() => {
          setIsLoading(false)
          toast.success("전화번호 인증이 완료되었습니다")
          form.setValue("step", "success")
        }, 1000)
      } catch (error) {
        console.error("Failed to verify code:", error)
        toast.error("인증번호가 올바르지 않습니다")
        setIsLoading(false)
      }
    }
  }

  const handleResendCode = async () => {
    setIsLoading(true)
    try {
      await sendTwilioMessage({
        countryCode,
        phoneNumber,
      })

      form.setValue("verificationCode", "")
      toast.success("인증번호가 재전송되었습니다")
      setIsLoading(false)
    } catch (error) {
      console.error("Failed to resend code:", error)
      toast.error("인증번호 재전송에 실패했습니다")
      setIsLoading(false)
    }
  }

  // 인증 완료 후 PIN 설정 폼 표시
  if (step === "success") {
    return <PinSetupForm redirectTo={redirectTo} />
  }

  return (
    <div className="flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-8 pt-8 pb-6">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              전화번호 인증
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {step === "phone" &&
                "비밀번호 설정을 위해 휴대폰 인증이 필요합니다"}
              {step === "verify" &&
                "문자로 받으신 6자리 인증번호를 입력해주세요"}
            </p>
          </div>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-8 px-8 py-6"
            >
              {step === "phone" && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label
                      htmlFor="phone"
                      className="text-sm font-medium text-slate-700"
                    >
                      휴대폰 번호
                    </Label>

                    <Controller
                      name="phoneNumber"
                      control={form.control}
                      render={({ field }) => (
                        <CustomPhoneInput
                          value={field.value}
                          onChange={field.onChange}
                          countryCode={form.watch("countryCode") as string}
                          className="h-12 border-slate-200 text-base placeholder:text-xs focus:border-slate-400 focus:ring-slate-400/20"
                          placeholder="010-0000-0000"
                        />
                      )}
                    />
                  </div>

                  {form.formState.errors.phoneNumber && (
                    <p className="text-sm text-red-500">
                      {form.formState.errors.phoneNumber.message}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={!phoneNumber || isLoading}
                    className="h-12 w-full cursor-pointer rounded-lg font-medium transition-colors hover:opacity-95"
                  >
                    {isLoading ? "전송 중..." : "인증번호 받기"}
                  </Button>
                </div>
              )}

              {step === "verify" && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label
                      htmlFor="code"
                      className="text-sm font-medium text-slate-700"
                    >
                      인증번호
                    </Label>
                    <Controller
                      name="verificationCode"
                      control={form.control}
                      render={({ field }) => (
                        <Input
                          id="code"
                          type="text"
                          placeholder="000000"
                          maxLength={6}
                          value={field.value}
                          onChange={(e) =>
                            field.onChange(e.target.value.replace(/\D/g, ""))
                          }
                          className="h-12 border-slate-200 text-center font-mono text-base tracking-widest placeholder:text-slate-400 focus:border-slate-400 focus:ring-slate-400/20"
                        />
                      )}
                    />
                  </div>

                  {form.formState.errors.verificationCode && (
                    <p className="text-sm text-red-500">
                      {form.formState.errors.verificationCode.message}
                    </p>
                  )}

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">{phoneNumber}</span>
                    <button
                      type="button"
                      onClick={() => {
                        form.setValue("step", "phone")
                        form.setValue("verificationCode", "")
                      }}
                      className="font-medium text-slate-600 transition-colors hover:text-slate-900"
                    >
                      번호 변경
                    </button>
                  </div>

                  <Button
                    type="submit"
                    disabled={verificationCode.length !== 6 || isLoading}
                    className="h-12 w-full cursor-pointer rounded-lg font-medium transition-colors hover:opacity-95"
                  >
                    {isLoading ? "확인 중..." : "인증하기"}
                  </Button>

                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={isLoading}
                    className="w-full text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 disabled:opacity-50"
                  >
                    인증번호 재전송
                  </button>
                </div>
              )}
            </form>
          </Form>
        </div>
      </div>
    </div>
  )
}
