"use client"

import Link from "next/link"
import { useRef, useState, useTransition } from "react"

import { findUserIdAction, sendRecoveryCodeAction } from "@/app/actions"
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

export function FindIdForm({ redirectTo }: { redirectTo: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [codeSent, setCodeSent] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loginIds, setLoginIds] = useState<string[] | null>(null)

  function sendCode() {
    const form = formRef.current
    if (!form) return

    setError(null)
    setMessage(null)
    setLoginIds(null)

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

  function submit(formData: FormData) {
    setError(null)
    setMessage(null)
    setLoginIds(null)

    startTransition(async () => {
      const res = await findUserIdAction(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }

      setLoginIds(res.loginIds)
      setMessage("휴대폰 번호와 연결된 아이디를 찾았습니다.")
    })
  }

  return (
    <form ref={formRef} action={submit} className="flex flex-col gap-4">
      <FieldGroup>
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
      {loginIds && (
        <Alert>
          <AlertTitle>찾은 아이디</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {loginIds.map((loginId) => (
                <li key={loginId} className="font-medium text-foreground">
                  {loginId}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={pending || !codeSent}>
        {pending ? "확인 중..." : "아이디 찾기"}
      </Button>
      <Button asChild variant="ghost" size="sm">
        <Link href={signinHref(redirectTo)}>로그인으로 돌아가기</Link>
      </Button>
    </form>
  )
}
