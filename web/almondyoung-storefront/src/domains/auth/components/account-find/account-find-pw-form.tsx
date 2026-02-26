"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import { CustomInput } from "@/components/shared/inputs/custom-input"
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
import { resetPassword } from "@lib/api/users/forgot/reset-password"
import { useForgetPw } from "domains/auth/hooks/use-forget-pw"
import useTwilio from "domains/payment/components/hooks/use-twilio"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowLeft, Check } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import z from "zod"
import {
  formatPhone,
  getSendCountFromStorage,
  saveSendCountToStorage,
} from "./utils"

// ============================================
// Types & Constants
// ============================================

type FlowStep = "phone-input" | "phone-verify" | "reset-password" | "success"

const STEPS = ["휴대폰 인증", "비밀번호 재설정"] as const
const SEND_COUNT_STORAGE_KEY = "find-pw-sms-send"

const stepVariants = {
  enter: { opacity: 0, y: 20 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
}

const findPwSchema = z.object({
  loginId: z.string().min(1, "아이디를 입력해주세요"),
  phoneNumber: z.string().min(1, "휴대폰 번호를 입력해주세요"),
  password: z.string().optional(),
  passwordConfirm: z.string().optional(),
})

type FindPwFormData = z.infer<typeof findPwSchema>

function getPasswordStrength(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0
  let score = 0
  if (password.length >= 8) score++
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++
  if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score++
  return score as 0 | 1 | 2 | 3
}

function getStepIndex(step: FlowStep): number {
  if (step === "phone-input" || step === "phone-verify") return 0
  return 1
}

function StepProgressBar({ currentStep }: { currentStep: FlowStep }) {
  const activeIndex = getStepIndex(currentStep)
  const isSuccess = currentStep === "success"

  return (
    <div className="mb-6 flex items-center justify-center gap-0">
      {STEPS.map((label, index) => {
        const isCompleted = isSuccess || index < activeIndex
        const isCurrent = !isSuccess && index === activeIndex

        return (
          <div key={label} className="flex items-center">
            {index > 0 && (
              <div
                className={`mx-2 h-0.5 w-8 transition-colors duration-300 ${
                  isCompleted ? "bg-green-30" : "bg-gray-20"
                }`}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors duration-300 ${
                  isCompleted
                    ? "bg-green-30 text-white"
                    : isCurrent
                      ? "bg-yellow-30 text-white"
                      : "bg-gray-20 text-gray-40"
                }`}
              >
                {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </div>
              <span
                className={`text-xs font-medium transition-colors duration-300 ${
                  isCompleted
                    ? "text-green-30"
                    : isCurrent
                      ? "text-yellow-30"
                      : "text-gray-30"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PasswordStrengthBar({ password }: { password: string }) {
  const strength = getPasswordStrength(password)
  if (!password) return null

  const labels = ["", "약함", "보통", "강함"]
  const colors = ["", "bg-red-30", "bg-yellow-30", "bg-green-30"]
  const textColors = ["", "text-red-30", "text-yellow-30", "text-green-30"]

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3].map((level) => (
          <div
            key={level}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              level <= strength ? colors[strength] : "bg-gray-20"
            }`}
          />
        ))}
      </div>
      {strength > 0 && (
        <span className={`text-xs font-medium ${textColors[strength]}`}>
          {labels[strength]}
        </span>
      )}
    </div>
  )
}

export function AccountFindPwForm() {
  const { forgetPw, isLoading } = useForgetPw()
  const { countryCode } = useParams<{ countryCode: string }>()
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState<FlowStep>("phone-input")
  const [verificationCode, setVerificationCode] = useState("")
  const [verifiedPhoneNumber, setVerifiedPhoneNumber] = useState<string | null>(
    null
  )
  const [isResetting, setIsResetting] = useState(false)
  const [successCountdown, setSuccessCountdown] = useState(3)
  const [wasVerifyPending, setWasVerifyPending] = useState(false)

  // 재전송 카운터 (1분 3회 제한) - sessionStorage 동기화
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

  const form = useForm<FindPwFormData>({
    resolver: zodResolver(findPwSchema),
    mode: "onChange",
    defaultValues: {
      loginId: "",
      phoneNumber: "",
      password: "",
      passwordConfirm: "",
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

  // 인증번호 발송 성공 → phone-verify 단계로 자동 전환
  useEffect(() => {
    if (isCodeSent && !isCodeSendPending && currentStep === "phone-input") {
      setCurrentStep("phone-verify")
    }
  }, [isCodeSent, isCodeSendPending, currentStep])

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

  // 인증 완료 시 → reset-password 단계로 자동 전환
  useEffect(() => {
    if (isCodeVerified && currentStep === "phone-verify") {
      setVerifiedPhoneNumber(phoneNumber)
      const timeout = setTimeout(() => {
        setCurrentStep("reset-password")
      }, 600)
      return () => clearTimeout(timeout)
    }
  }, [isCodeVerified, currentStep, phoneNumber])

  // 번호 변경 감지
  useEffect(() => {
    if (
      verifiedPhoneNumber &&
      phoneNumber !== verifiedPhoneNumber &&
      currentStep === "reset-password"
    ) {
      setVerifiedPhoneNumber(null)
      setVerificationCode("")
      setCurrentStep("phone-input")
      form.setValue("password", "")
      form.setValue("passwordConfirm", "")
    }
  }, [phoneNumber, verifiedPhoneNumber, currentStep, form])

  // 성공 화면 카운트다운 + 자동 리다이렉트
  useEffect(() => {
    if (currentStep !== "success") return
    if (successCountdown <= 0) {
      router.push(`/${countryCode}/login`)
      return
    }
    const timeout = setTimeout(() => {
      setSuccessCountdown((prev) => prev - 1)
    }, 1000)
    return () => clearTimeout(timeout)
  }, [currentStep, successCountdown, countryCode, router])

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
      // 6자리 완성 시 자동 제출
      if (value.length === 6) {
        handleVerifyCode(value)
      }
    },
    [handleVerifyCode]
  )

  const handleChangeNumber = useCallback(() => {
    setVerificationCode("")
    setVerifiedPhoneNumber(null)
    setCurrentStep("phone-input")
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

  const handleResetPassword = async () => {
    const loginId = form.getValues("loginId")
    const password = form.getValues("password") || ""
    const passwordConfirm = form.getValues("passwordConfirm") || ""

    if (!loginId) {
      form.setError("loginId", { message: "아이디를 입력해주세요" })
      return
    }

    if (password.length < 8) {
      form.setError("password", {
        message: "비밀번호는 8자 이상이어야 합니다.",
      })
      return
    }

    if (password !== passwordConfirm) {
      form.setError("passwordConfirm", {
        message: "비밀번호가 일치하지 않습니다.",
      })
      return
    }

    setIsResetting(true)
    form.clearErrors("root")

    // 1. forgetPw(phone, loginId) → token
    const result = await forgetPw(phoneNumber, loginId)

    if (!result.success) {
      if (
        result.error?.message?.includes("휴대폰") ||
        result.error?.message?.includes("아이디")
      ) {
        form.setError("root", {
          message: "입력하신 정보가 일치하지 않습니다.",
        })
      } else {
        form.setError("root", {
          message: "오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        })
      }
      setIsResetting(false)
      return
    }

    const token = result.verificationToken
    if (!token) {
      form.setError("root", {
        message: "인증 토큰을 받지 못했습니다. 다시 시도해주세요.",
      })
      setIsResetting(false)
      return
    }

    // 2. resetPassword(token, password) → 완료
    const resetResult = await resetPassword(token, password)
    if ("data" in resetResult) {
      setCurrentStep("success")
    } else {
      toast.error(resetResult.error.message || "비밀번호 변경에 실패했습니다.")
    }
    setIsResetting(false)
  }

  return (
    <section className="flex min-h-lvh w-full max-w-[375px] flex-col justify-center px-4">
      {/* Quick-exit Navigation */}
      <div className="mb-4 flex items-center justify-between">
        <LocalizedClientLink
          href="/login"
          className="text-gray-40 hover:text-gray-60 flex items-center gap-1 text-xs transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          로그인
        </LocalizedClientLink>
        <LocalizedClientLink
          href="/find/id"
          className="text-gray-40 hover:text-gray-60 text-xs transition-colors"
        >
          아이디 찾기
        </LocalizedClientLink>
      </div>

      {/* Header */}
      <div className="mb-2 text-center">
        <h2 className="text-2xl font-bold">비밀번호 찾기</h2>
        <p className="text-muted-foreground mt-2 text-sm tracking-tighter">
          가입 시 등록한 휴대폰 번호로 비밀번호를 재설정할 수 있습니다.
        </p>
      </div>

      {/* Step Progress Bar */}
      <StepProgressBar currentStep={currentStep} />

      <Form {...form}>
        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
          <AnimatePresence mode="wait">
            {/* ======================== */}
            {/* Step 1a: 핸드폰 번호 입력 */}
            {/* ======================== */}
            {currentStep === "phone-input" && (
              <motion.div
                key="phone-input"
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3 }}
                className="space-y-4"
              >
                <div className="bg-card space-y-4 rounded-lg border p-4">
                  <p className="text-gray-60 text-sm font-semibold">
                    휴대폰 번호를 입력해주세요
                  </p>

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
                    size="lg"
                    className="w-full cursor-pointer"
                    disabled={
                      isCodeSendPending || sendCount >= 3 || !phoneNumber
                    }
                    isLoading={isCodeSendPending}
                    onClick={handleSendCode}
                  >
                    인증번호 받기
                  </CustomButton>

                  {sendCount >= 3 && (
                    <p className="text-center text-xs text-red-500">
                      1분 후 다시 시도해주세요
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {/* ============================ */}
            {/* Step 1b: 인증번호 확인 (OTP) */}
            {/* ============================ */}
            {currentStep === "phone-verify" && (
              <motion.div
                key="phone-verify"
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3 }}
                className="space-y-4"
              >
                <div className="bg-card space-y-4 rounded-lg border p-4">
                  <div>
                    <p className="text-gray-60 text-sm font-semibold">
                      인증번호를 입력해주세요
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatPhone(phoneNumber)}으로 발송된 6자리 인증번호를
                      입력해주세요.
                    </p>
                  </div>

                  {/* OTP Input */}
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

                  {/* 인증 중 표시 */}
                  {isCodeVerifyPending && (
                    <div className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
                      <Spinner size="sm" />
                      인증 확인 중...
                    </div>
                  )}

                  {/* 인증 성공 표시 */}
                  {isCodeVerified && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-green-30 flex items-center justify-center gap-2 text-sm font-medium"
                    >
                      <Check className="h-4 w-4" />
                      인증이 완료되었습니다
                    </motion.div>
                  )}

                  {/* 타이머 & 액션 */}
                  {!isCodeVerified && (
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
                  )}
                </div>
              </motion.div>
            )}

            {/* ========================================== */}
            {/* Step 2: 아이디 + 비밀번호 통합 (핵심 변경) */}
            {/* ========================================== */}
            {currentStep === "reset-password" && (
              <motion.div
                key="reset-password"
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3 }}
                className="space-y-4"
              >
                <div className="bg-card space-y-4 rounded-lg border p-4">
                  <div>
                    <p className="text-gray-60 text-sm font-semibold">
                      아이디와 새 비밀번호를 입력해주세요
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      가입 시 등록한 아이디를 입력해주세요.
                    </p>
                  </div>

                  {/* 아이디 */}
                  <FormField
                    control={form.control}
                    name="loginId"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <CustomInput
                            {...field}
                            label="아이디"
                            disabled={isResetting}
                            autoComplete="username"
                            className="pr-10"
                            hasValue={!!field.value}
                            onClear={() => form.setValue("loginId", "")}
                            error={!!form.formState.errors.loginId}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 새 비밀번호 */}
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <CustomInput
                            {...field}
                            type="password"
                            label="새 비밀번호"
                            disabled={isResetting}
                            className="pr-10"
                            hasValue={!!field.value}
                            onClear={() => form.setValue("password", "")}
                            error={!!form.formState.errors.password}
                          />
                        </FormControl>
                        <PasswordStrengthBar password={field.value || ""} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 비밀번호 확인 */}
                  <FormField
                    control={form.control}
                    name="passwordConfirm"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <CustomInput
                            {...field}
                            type="password"
                            label="비밀번호 확인"
                            disabled={isResetting}
                            className="pr-10"
                            hasValue={!!field.value}
                            onClear={() => form.setValue("passwordConfirm", "")}
                            error={!!form.formState.errors.passwordConfirm}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 에러 메시지 */}
                  {form.formState.errors.root && (
                    <p className="text-center text-sm text-red-500">
                      {form.formState.errors.root.message}
                    </p>
                  )}

                  <CustomButton
                    type="button"
                    className="w-full"
                    disabled={isResetting || isLoading}
                    size="lg"
                    onClick={handleResetPassword}
                  >
                    {isResetting || isLoading ? (
                      <Spinner size="sm" color="white" />
                    ) : (
                      "비밀번호 변경"
                    )}
                  </CustomButton>
                </div>
              </motion.div>
            )}

            {/* ==================== */}
            {/* Step 3: 성공 화면 */}
            {/* ==================== */}
            {currentStep === "success" && (
              <motion.div
                key="success"
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center space-y-6 py-8"
              >
                {/* 체크마크 애니메이션 */}
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{
                    type: "spring",
                    stiffness: 260,
                    damping: 20,
                    delay: 0.1,
                  }}
                  className="bg-green-30 flex h-20 w-20 items-center justify-center rounded-full"
                >
                  <motion.div
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.3 }}
                  >
                    <Check className="h-10 w-10 text-white" strokeWidth={3} />
                  </motion.div>
                </motion.div>

                <div className="text-center">
                  <h3 className="text-xl font-bold">비밀번호 변경 완료!</h3>
                  <p className="text-muted-foreground mt-2 text-sm">
                    {successCountdown}초 후 로그인 페이지로 이동합니다
                  </p>
                </div>

                <CustomButton
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={() => router.push(`/${countryCode}/login`)}
                >
                  지금 로그인하기
                </CustomButton>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </Form>
    </section>
  )
}
