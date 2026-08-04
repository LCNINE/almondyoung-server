"use client"

import Link from "next/link"
import { useRef, useState, useTransition } from "react"

import {
  RecoveryField,
  findUserIdAction,
  issuePasswordResetTokenAction,
  resetForgottenPasswordAction,
  sendRecoveryCodeAction,
} from "@/app/actions"
import { PasswordInput } from "@/components/password-input"
import { PhoneNumberInput } from "@/components/phone-number-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldDescription } from "@/components/ui/field"
import {
  FloatingField,
  FloatingLabelInput,
  floatingInputClass,
} from "@/components/ui/floating-label-input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

function signinHref(redirectTo: string) {
  return `/signin${
    redirectTo
      ? `?${new URLSearchParams({ redirect_to: redirectTo }).toString()}`
      : ""
  }`
}

type Step = "verify" | "accounts" | "reset" | "complete"

export function FindAccountForm({ redirectTo }: { redirectTo: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [step, setStep] = useState<Step>("verify")
  const [codeSent, setCodeSent] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<RecoveryField | null>(null)
  const [loginIds, setLoginIds] = useState<string[]>([])
  const [phoneNumber, setPhoneNumber] = useState("")
  const [phoneInput, setPhoneInput] = useState("")
  const [resettingLoginId, setResettingLoginId] = useState("")

  function fail(res: { error: string; field?: RecoveryField }) {
    setError(res.error)
    setErrorField(res.field ?? null)
  }

  function clear() {
    setError(null)
    setErrorField(null)
    setMessage(null)
  }

  function sendCode() {
    const form = formRef.current
    if (!form) return
    if (!phoneRef.current?.reportValidity()) return

    clear()

    startTransition(async () => {
      const res = await sendRecoveryCodeAction(new FormData(form))
      if (!res.ok) {
        fail(res)
        return
      }

      const codeInput = form.elements.namedItem("code")
      if (codeInput instanceof HTMLInputElement) codeInput.value = ""

      setPhoneNumber(res.phoneNumber)
      setPhoneInput(String(new FormData(form).get("phoneNumber") ?? ""))
      setCodeSent(true)
      setMessage("인증번호를 발송했습니다.")
    })
  }

  function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    clear()

    startTransition(async () => {
      const res = await findUserIdAction(formData)
      if (!res.ok) {
        fail(res)
        return
      }

      setLoginIds(res.loginIds)
      setStep("accounts")
    })
  }

  function startReset(loginId: string) {
    clear()

    startTransition(async () => {
      const res = await issuePasswordResetTokenAction(loginId, phoneNumber)
      if (!res.ok) {
        setStep("verify")
        setCodeSent(false)
        fail(res)
        return
      }

      setResettingLoginId(loginId)
      setStep("reset")
    })
  }

  function resetPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    clear()

    startTransition(async () => {
      const res = await resetForgottenPasswordAction(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }

      setStep("complete")
    })
  }

  if (step === "complete") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>비밀번호 변경 완료</AlertTitle>
          <AlertDescription>
            {resettingLoginId} 계정의 새 비밀번호로 로그인해주세요.
          </AlertDescription>
        </Alert>
        <Button asChild className="h-[52px] rounded-lg text-base font-bold">
          <Link href={signinHref(redirectTo)}>로그인하러 가기</Link>
        </Button>
      </div>
    )
  }

  if (step === "reset") {
    return (
      <form onSubmit={resetPassword} className="flex flex-1 flex-col gap-4">
        <FieldDescription>
          {resettingLoginId} 계정의 새 비밀번호를 입력해주세요.
        </FieldDescription>
        <PasswordInput
          id="password"
          name="password"
          label="새 비밀번호"
          placeholder=" "
          className={floatingInputClass}
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={20}
        />
        <FieldDescription>
          영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.
        </FieldDescription>
        <PasswordInput
          id="passwordConfirm"
          name="passwordConfirm"
          label="새 비밀번호 확인"
          placeholder=" "
          className={floatingInputClass}
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={20}
        />

        <p className="min-h-5 text-sm text-destructive" role="alert">
          {error}
        </p>

        <Button
          type="submit"
          disabled={pending}
          className={cn(
            "mt-auto h-[52px] rounded-lg text-base font-bold",
            pending && "disabled:bg-primary disabled:text-primary-foreground"
          )}
        >
          {pending ? <Spinner className="size-5" /> : "비밀번호 변경"}
        </Button>
      </form>
    )
  }

  if (step === "accounts") {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <Alert>
          <AlertTitle>찾은 아이디</AlertTitle>
          <AlertDescription>
            <ul className="flex w-full flex-col gap-2">
              {loginIds.map((loginId) => (
                <li
                  key={loginId}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="font-medium text-foreground">{loginId}</span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => startReset(loginId)}
                    className="h-9 shrink-0 rounded-lg text-sm"
                  >
                    비밀번호 재설정
                  </Button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>

        <p className="min-h-5 text-sm text-destructive" role="alert">
          {error}
        </p>

        <Button
          asChild
          className="mt-auto h-[52px] rounded-lg text-base font-bold"
        >
          <Link href={signinHref(redirectTo)}>로그인하러 가기</Link>
        </Button>
      </div>
    )
  }

  return (
    <form ref={formRef} onSubmit={verify} className="flex flex-1 flex-col gap-4">
      <div className="flex items-start gap-2">
        <FloatingField
          htmlFor="phoneNumber"
          label="휴대폰 번호"
          className="flex-1"
        >
          <PhoneNumberInput
            ref={phoneRef}
            id="phoneNumber"
            name="phoneNumber"
            defaultValue={phoneInput}
            required
            pattern="0[0-9]{1,2}-[0-9]{3,4}-[0-9]{4}"
            title="휴대폰 번호를 010-1234-5678 형식으로 입력해주세요."
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder=" "
            className={floatingInputClass}
          />
        </FloatingField>

        <Button
          type="button"
          variant={codeSent ? "outline" : "default"}
          onClick={sendCode}
          disabled={pending}
          className="h-14 shrink-0 rounded-lg px-4"
        >
          {codeSent ? "재발송" : "인증번호 받기"}
        </Button>
      </div>
      <FieldDescription>
        가입 시 등록한 휴대폰 번호를 입력해주세요.
      </FieldDescription>
      {errorField === "phoneNumber" && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {codeSent && (
        <div className="flex flex-col gap-1">
          <FloatingLabelInput
            id="code"
            name="code"
            label="인증번호 6자리"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            minLength={6}
            maxLength={6}
          />
          {errorField === "code" && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <p
        className={cn(
          "min-h-5 text-sm",
          error && !errorField ? "text-destructive" : "text-muted-foreground"
        )}
        role={error && !errorField ? "alert" : undefined}
      >
        {errorField ? message : (error ?? message)}
      </p>

      <Button
        type="submit"
        disabled={pending || !codeSent}
        className={cn(
          "mt-auto h-[52px] rounded-lg text-base font-bold",
          pending && "disabled:bg-primary disabled:text-primary-foreground"
        )}
      >
        {pending ? <Spinner className="size-5" /> : "다음"}
      </Button>
      <div className="flex items-center justify-center text-sm">
        <Link
          href={signinHref(redirectTo)}
          className="rounded-md px-1 py-2 text-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          로그인
        </Link>
      </div>
    </form>
  )
}
