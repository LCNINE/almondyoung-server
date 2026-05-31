"use client"

import Link from "next/link"
import { useRef, useState, useTransition } from "react"

import {
  resetForgottenPasswordAction,
  sendRecoveryCodeAction,
  startPasswordResetAction,
} from "@/app/actions"
import { PhoneNumberInput } from "@/components/phone-number-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

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
        <Button asChild>
          <Link href={signinHref(redirectTo)}>로그인으로 돌아가기</Link>
        </Button>
      </div>
    )
  }

  if (resetReady) {
    return (
      <form action={resetPassword} className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="password">새 비밀번호</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={20}
            />
            <FieldDescription>
              영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="passwordConfirm">새 비밀번호 확인</FieldLabel>
            <Input
              id="passwordConfirm"
              name="passwordConfirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={20}
            />
          </Field>
        </FieldGroup>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        <Button type="submit" disabled={pending}>
          {pending ? "변경 중..." : "비밀번호 변경"}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={signinHref(redirectTo)}>로그인으로 돌아가기</Link>
        </Button>
      </form>
    )
  }

  return (
    <form ref={formRef} action={startReset} className="flex flex-col gap-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="loginId">아이디</FieldLabel>
          <Input
            id="loginId"
            name="loginId"
            required
            minLength={4}
            maxLength={20}
            pattern="[a-z0-9]+"
            autoComplete="username"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="phoneNumber">휴대폰 번호</FieldLabel>
          <div className="flex gap-2">
            <PhoneNumberInput
              id="phoneNumber"
              name="phoneNumber"
              required
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="010-1234-5678"
            />
            <Button
              type="button"
              variant="outline"
              onClick={sendCode}
              disabled={pending}
            >
              인증번호
            </Button>
          </div>
          <FieldDescription>
            가입 시 등록한 휴대폰 번호를 입력해주세요.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="code">인증번호</FieldLabel>
          <Input
            id="code"
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            minLength={6}
            maxLength={6}
            disabled={!codeSent}
          />
        </Field>
      </FieldGroup>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <Button type="submit" disabled={pending || !codeSent}>
        {pending ? "확인 중..." : "본인 확인"}
      </Button>
      <Button asChild variant="ghost" size="sm">
        <Link href={signinHref(redirectTo)}>로그인으로 돌아가기</Link>
      </Button>
    </form>
  )
}
