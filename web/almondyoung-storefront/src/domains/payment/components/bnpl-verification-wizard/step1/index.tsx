"use client"

import { Spinner } from "@/components/shared/spinner"
import { Button } from "@components/common/ui/button"
import { Input } from "@components/common/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/common/ui/select"
import { zodResolver } from "@hookform/resolvers/zod"
import { updateProfile } from "@lib/api/users/profile"
import { UserDetail } from "@lib/types/ui/user"
import { cn } from "@lib/utils"
import { format } from "date-fns"
import "intl-tel-input/build/css/intlTelInput.css"
import { useEffect, useRef, useState, useTransition } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import useTwilio from "../../hooks/use-twilio"
import CustomPhoneInput from "@/components/shared/inputs/phone-input"

const schema = z.object({
  name: z.string().min(1, "이름을 입력해주세요"),
  residentNumberFront: z.string().min(1, "주민번호 앞자리를 입력해주세요"),
  residentNumberBack: z.string().min(1, "주민번호 뒷자리를 입력해주세요"),
  phoneNumber: z.string().min(1, "전화번호를 입력해주세요"),
  countryCode: z.string().min(1, "국가코드를 선택해주세요"),
  carrier: z.string().min(1, "통신사를 선택해주세요"),
})

type FormData = z.infer<typeof schema>

// 휴대폰 인증 스텝 컴포넌트
export function PhoneVerificationStep({
  onComplete,
  user,
  isVerification,
}: {
  onComplete: () => void
  user: UserDetail
  isVerification: boolean
}) {
  const verificationCodeRef = useRef<HTMLInputElement>(null)
  const [verificationCode, setVerificationCode] = useState("") // 인증번호
  const [isUpdateProfilePending, startUpdateProfileTransition] = useTransition()

  const {
    sendTwilioMessage,
    isCodeSendPending,
    isCodeSent,
    verifyCode,
    isCodeVerifyPending,
    isCodeVerified,
    timer,
  } = useTwilio()

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      residentNumberFront: "",
      residentNumberBack: "",
      phoneNumber: "",
      countryCode: "KR",
      carrier: "",
    },
  })

  useEffect(() => {
    if (user.profile?.phoneNumber) {
      form.setValue("phoneNumber", user.profile.phoneNumber)
    }
  }, [user.profile?.phoneNumber])

  useEffect(() => {
    if (isVerification) {
      onComplete()
    }
  }, [isVerification])

  const onSubmit = async (data: FormData) => {
    const birthDateFormatted = format(user.profile?.birthDate!, "yyMMdd")

    // 주민번호 앞자리와 비교
    if (birthDateFormatted !== data.residentNumberFront) {
      toast.error("생년월일이 일치하지 않습니다")
      return
    }

    // 인증번호 미발송 상태라면 인증번호 발송
    if (!isCodeSent) {
      sendTwilioMessage({
        countryCode: data.countryCode,
        phoneNumber: data.phoneNumber,
      })

      verificationCodeRef.current?.focus()
      return
    }

    // 인증 확인 API
    if (isCodeVerified) {
      try {
        startUpdateProfileTransition(async () => {
          await updateProfile({ phoneNumber: data.phoneNumber })
          onComplete()
        })
      } catch (error) {
        console.error("Failed to update profile:", error)
        toast.error(
          "휴대폰 번호 업데이트에 실패했습니다. 잠시 후 다시 시도해주세요"
        )
        return
      }
    }
  }
  const handleVerifyCode = async () => {
    if (!verificationCode) {
      toast.error("인증번호를 입력해주세요")
      verificationCodeRef.current?.focus()
      return
    }

    verifyCode({
      code: verificationCode,
      phoneNumber: form.watch("phoneNumber"),
    })
  }

  // 인증번호 재발송 핸들러
  const handleResendCode = () => {
    const phoneNumber = form.watch("phoneNumber")
    const countryCode = form.watch("countryCode")

    sendTwilioMessage({
      countryCode,
      phoneNumber,
    })
    setVerificationCode("") // 인증번호 입력 초기화
    verificationCodeRef.current?.focus()
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit, (errors) => {
        const firstError = Object.values(errors)[0]

        toast.error(firstError?.message || "입력값을 확인해주세요")
      })}
      className="space-y-4"
    >
      <p className="bg-gray-10 px-4 py-2 text-sm text-gray-600">
        결제수단 등록을 위해서 본인인증을 진행해주세요. 아몬드영 인증 서비스를
        통해 안전하게 진행됩니다.
      </p>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">휴대폰 인증</h2>
          <span>(본인 명의의 휴대폰만 인증 가능)</span>
        </div>

        <Input placeholder="이름" {...form.register("name")} required />

        <div className="flex items-center gap-2">
          <Input
            required
            placeholder="생년월일(6자리)"
            maxLength={6}
            className="flex-1"
            {...form.register("residentNumberFront", {
              onChange: (e) => {
                const value = e.target.value.replace(/\D/g, "")
                form.setValue("residentNumberFront", value)
                if (value.length === 6) {
                  // 다음 input으로 포커스 이동
                  const next = document.querySelector<HTMLInputElement>(
                    'input[name="residentNumberBack"]'
                  )

                  next?.focus()
                }
              },
            })}
          />
          <span className="text-gray-400">-</span>

          <div className="relative flex-1">
            <Input
              required
              placeholder="0******"
              className="w-full"
              maxLength={1}
              {...form.register("residentNumberBack", {
                onChange: (e) => {
                  const value = e.target.value.replace(/\D/g, "")
                  form.setValue("residentNumberBack", value)
                },
              })}
            />
            {form.watch("residentNumberBack") && (
              <span className="pointer-events-none absolute top-1/2 left-6 -translate-y-1/2 text-gray-400">
                ******
              </span>
            )}
          </div>
        </div>

        <div className="flex w-full gap-2">
          <Controller
            name="carrier"
            control={form.control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  className={cn(
                    "bg-gray-10 w-32 shrink-0",
                    form.formState.errors.carrier && "border-destructive"
                  )}
                >
                  <SelectValue placeholder="통신사 선택" />
                </SelectTrigger>
                <SelectContent className="bg-gray-10">
                  <SelectItem
                    value="skt"
                    className="hover:bg-gray-20! hover:text-gray-90!"
                  >
                    SKT
                  </SelectItem>
                  <SelectItem
                    className="hover:bg-gray-20! hover:text-gray-90!"
                    value="kt"
                  >
                    KT
                  </SelectItem>
                  <SelectItem
                    className="hover:bg-gray-20! hover:text-gray-90!"
                    value="lgu"
                  >
                    LG U+
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          />

          <Controller
            name="phoneNumber"
            control={form.control}
            render={({ field }) => (
              <CustomPhoneInput
                value={field.value}
                onChange={field.onChange}
                countryCode={form.watch("countryCode")}
              />
            )}
          />
        </div>

        {isCodeSent && (
          <div className="flex items-center gap-2">
            <Input
              ref={verificationCodeRef}
              placeholder="인증번호 6자리"
              maxLength={6}
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
            />

            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                onClick={handleVerifyCode}
                className="whitespace-nowrap"
              >
                {isCodeVerifyPending ? (
                  <Spinner size="sm" color="gray" />
                ) : (
                  "인증번호 인증"
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 인증 완료 - 다음 단계 */}
      {isCodeVerified && (
        <Button
          type="submit"
          className="w-full bg-amber-500"
          disabled={isUpdateProfilePending}
        >
          {isUpdateProfilePending ? (
            <Spinner size="sm" color="gray" />
          ) : (
            "다음 단계"
          )}
        </Button>
      )}

      {/* 인증번호 미발송 - 인증번호 발송 */}
      {!isCodeSent && (
        <Button
          type="submit"
          className="w-full bg-amber-500"
          disabled={isCodeSendPending}
        >
          {isCodeSendPending ? (
            <Spinner size="sm" color="gray" />
          ) : (
            "인증번호 발송"
          )}
        </Button>
      )}

      {/* 인증번호 발송했지만 아직 인증 안됨 */}
      {isCodeSent && !isCodeVerified && (
        <Button
          type="button"
          onClick={timer > 0 ? undefined : handleResendCode}
          className="w-full bg-amber-500"
          disabled={isCodeSendPending || timer > 0}
        >
          {isCodeSendPending ? (
            <Spinner size="sm" color="gray" />
          ) : timer > 0 ? (
            <span className="font-mono text-sm font-medium tabular-nums">
              {timer}초 후 재발송 가능
            </span>
          ) : (
            "인증번호 재발송"
          )}
        </Button>
      )}
    </form>
  )
}
