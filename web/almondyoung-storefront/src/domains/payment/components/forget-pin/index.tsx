"use client"

import { Button } from "@components/common/ui/button"
import { Form } from "@components/common/ui/form"
import { Input } from "@components/common/ui/input"
import { Label } from "@components/common/ui/label"
import CustomPhoneInput from "@/components/shared/inputs/phone-input"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import useTwilio from "../hooks/use-twilio"
import { ForgetPinSchema, forgetPinSchema } from "./schema"
import PinSetupForm from "../security-pin/pin-setup-form"

export default function ForgetPinForm() {
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<ForgetPinSchema>({
    resolver: zodResolver(forgetPinSchema),
    mode: "onChange",
    defaultValues: {
      phoneNumber: "",
      verificationCode: "",
      step: "phone",
      countryCode: "KR",
      purpose: "forget_pin",
    },
  })

  const step = form.watch("step")
  const phoneNumber = form.watch("phoneNumber")
  const verificationCode = form.watch("verificationCode")
  const countryCode = form.watch("countryCode")

  const { sendTwilioMessage, verifyCode } = useTwilio()

  const handleSubmit = async (data: ForgetPinSchema) => {
    if (step === "phone") {
      // 인증번호 발송
      setIsLoading(true)
      try {
        await sendTwilioMessage({
          countryCode: data.countryCode,
          phoneNumber: data.phoneNumber,
          purpose: data.purpose,
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
      // 인증번호 검증
      setIsLoading(true)
      try {
        await verifyCode({
          phoneNumber: data.phoneNumber,
          code: data.verificationCode,
        })

        setTimeout(() => {
          setIsLoading(false)
          toast.success("인증이 완료되었습니다")
          form.setValue("step", "success")
        }, 1000)
      } catch (error) {
        console.error("Failed to verify code:", error)
        toast.error("인증번호가 올바르지 않습니다")
        setIsLoading(false)
      }
    }

    return
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

  return (
    <div className="flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-xl">
          {/* Header */}
          <div
            className={`border-b border-slate-100 px-8 pt-8 pb-6 ${step === "success" && "hidden"}`}
          >
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              PIN 번호 재설정
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {step === "phone" &&
                "등록하신 휴대폰 번호로 인증번호를 보내드립니다"}
              {step === "verify" &&
                "문자로 받으신 6자리 인증번호를 입력해주세요"}
            </p>
          </div>

          {/* Content */}
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

              {step === "success" && <PinSetupForm isForgetPinPage={true} />}
            </form>
          </Form>
        </div>

        {/* Footer Helper Text */}
        <p className="mt-6 text-center text-sm text-slate-500">
          문제가 계속되나요?{" "}
          <Link
            href="https://pf.kakao.com/_xaxgxazs"
            target="_blank"
            className="font-medium text-slate-700 transition-colors hover:text-slate-900"
          >
            고객센터
          </Link>
        </p>
      </div>
    </div>
  )
}
