"use client"

import Link from "next/link"
import { useRef, useState, useTransition } from "react"

import { findUserIdAction, sendRecoveryCodeAction } from "@/app/actions"
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
    <form ref={formRef} action={submit} className="flex flex-1 flex-col gap-4">
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

      <Button
        type="submit"
        disabled={pending || !codeSent}
        className={cn(
          "mt-auto h-[52px] rounded-lg text-base font-bold",
          pending && "disabled:bg-primary disabled:text-primary-foreground"
        )}
      >
        {pending ? <Spinner className="size-5" /> : "아이디 찾기"}
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
