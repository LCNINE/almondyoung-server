"use client"

import Link from "next/link"
import { useRef, useState, useTransition } from "react"

import {
  resetForgottenPasswordAction,
  sendRecoveryCodeAction,
  startPasswordResetAction,
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

export function ForgotPasswordForm({ redirectTo }: { redirectTo: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [codeSent, setCodeSent] = useState(false)
  const [resetReady, setResetReady] = useState(false)
  const [complete, setComplete] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function sendCode() {
    const form = formRef.current
    if (!form) return

    setError(null)
    setMessage(null)

    startTransition(async () => {
      const res = await sendRecoveryCodeAction(new FormData(form))
      if (!res.ok) {
        setError(res.error)
        return
      }

      setCodeSent(true)
      setMessage("인증번호를 발송했습니다.")
    })
  }

  function startReset(formData: FormData) {
    setError(null)
    setMessage(null)

    startTransition(async () => {
      const res = await startPasswordResetAction(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }

      setResetReady(true)
      setMessage("본인 확인이 완료되었습니다. 새 비밀번호를 입력해주세요.")
    })
  }

  function resetPassword(formData: FormData) {
    setError(null)
    setMessage(null)

    startTransition(async () => {
      const res = await resetForgottenPasswordAction(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }

      setComplete(true)
      setMessage("비밀번호가 변경되었습니다.")
    })
  }

  if (complete) {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>비밀번호 변경 완료</AlertTitle>
          <AlertDescription>
            새 비밀번호로 다시 로그인해주세요.
          </AlertDescription>
        </Alert>
        <Button asChild className="h-[52px] rounded-lg text-base font-bold">
          <Link href={signinHref(redirectTo)}>로그인으로 돌아가기</Link>
        </Button>
      </div>
    )
  }

  if (resetReady) {
    return (
      <form action={resetPassword} className="flex flex-1 flex-col gap-4">
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

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}

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
        <Button
          asChild
          variant="ghost"
          className="h-11 text-sm text-muted-foreground"
        >
          <Link href={signinHref(redirectTo)}>로그인으로 돌아가기</Link>
        </Button>
      </form>
    )
  }

  return (
    <form ref={formRef} action={startReset} className="flex flex-1 flex-col gap-4">
      <FloatingLabelInput
        id="loginId"
        name="loginId"
        label="아이디"
        required
        minLength={4}
        maxLength={20}
        pattern="[a-z0-9]+"
        autoComplete="username"
      />

      <div className="flex items-start gap-2">
        <FloatingField
          htmlFor="phoneNumber"
          label="휴대폰 번호"
          className="flex-1"
        >
          <PhoneNumberInput
            id="phoneNumber"
            name="phoneNumber"
            required
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

      {codeSent && (
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
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <Button
        type="submit"
        disabled={pending || !codeSent}
        className={cn(
          "mt-auto h-[52px] rounded-lg text-base font-bold",
          pending && "disabled:bg-primary disabled:text-primary-foreground"
        )}
      >
        {pending ? <Spinner className="size-5" /> : "본인 확인"}
      </Button>
      <Button
        asChild
        variant="ghost"
        className="h-11 text-sm text-muted-foreground"
      >
        <Link href={signinHref(redirectTo)}>로그인으로 돌아가기</Link>
      </Button>
    </form>
  )
}
