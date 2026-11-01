"use client"

import { useState, useTransition } from "react"

import { changeInitialPasswordAction } from "@/app/actions"
import { PasswordInput } from "@/components/password-input"
import { Button } from "@/components/ui/button"
import { floatingInputClass } from "@/components/ui/floating-label-input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export function ChangePasswordForm({ redirectTo }: { redirectTo: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await changeInitialPasswordAction(formData)
      if (res && !res.ok) setError(res.error)
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <PasswordInput
        id="currentPassword"
        name="currentPassword"
        label="지금 비밀번호"
        placeholder=" "
        className={floatingInputClass}
        autoComplete="current-password"
        required
        minLength={8}
        maxLength={20}
        autoFocus
      />
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
      <p className="text-sm text-muted-foreground">
        영문·숫자·특수문자를 섞어 8~20자
      </p>

      <p className="min-h-5 text-sm text-destructive" role="alert">
        {error}
      </p>

      <div className="mt-auto flex flex-col gap-2 pt-6">
        <Button
          type="submit"
          disabled={pending}
          className={cn(
            "h-[52px] rounded-lg text-base font-bold",
            pending && "disabled:bg-primary disabled:text-primary-foreground"
          )}
        >
          {pending ? <Spinner className="size-5" /> : "바꾸고 계속하기"}
        </Button>
      </div>
    </form>
  )
}
