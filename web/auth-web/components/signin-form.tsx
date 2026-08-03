"use client"

import Link from "next/link"
import { useState, useTransition } from "react"

import { signInAction } from "@/app/actions"
import { PasswordInput } from "@/components/password-input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  FloatingLabelInput,
  floatingInputClass,
} from "@/components/ui/floating-label-input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

type Props = {
  redirectTo: string
  /**
   * 재인증 흐름에서 prefill 할 loginId. 있으면 readOnly 로 잠그고,
   * 없으면 빈 입력 필드로 둔다.
   */
  prefilledLoginId?: string
  /**
   * 재인증 흐름에서 매칭을 강제할 userId. server action 이 hidden 필드로 받아
   * promoteTokens 의 expectUserId 로 전달한다.
   */
  reauthUserId?: string
}

export function SignInForm({
  redirectTo,
  prefilledLoginId = "",
  reauthUserId = "",
}: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const isReauth = reauthUserId.length > 0
  // 재인증이고 loginId 를 이미 아는 경우 아이디 필드를 노출하지 않는다. hidden 으로만 제출해
  // 자동완성이 다른 계정 아이디로 덮어써 expectUserId 매칭이 깨지는 사고를 막는다.
  // (서버는 reauthUserId 로 엄격 매칭하므로 hidden 값 변조도 차단된다.)
  const hasPrefilledLoginId = isReauth && prefilledLoginId.length > 0

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    // 여기서 setError(null) 하지 않는다 — 결과가 오면 덮어쓴다. 미리 지우면 에러 줄이 사라지며
    // 버튼이 위로 튀었다가 다시 내려온다 (성공하면 어차피 화면을 떠난다).
    startTransition(async () => {
      const res = await signInAction(formData)
      if (res && !res.ok) setError(res.error)
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input type="hidden" name="reauthUserId" value={reauthUserId} />
      {hasPrefilledLoginId ? (
        <input type="hidden" name="loginId" value={prefilledLoginId} />
      ) : (
        <FloatingLabelInput
          id="loginId"
          name="loginId"
          label="아이디"
          autoComplete="username"
          required
          minLength={4}
          maxLength={20}
          pattern="[a-z0-9]+"
          defaultValue={prefilledLoginId}
        />
      )}
      <PasswordInput
        id="password"
        name="password"
        label="비밀번호"
        placeholder=" "
        className={floatingInputClass}
        autoComplete="current-password"
        required
        minLength={8}
        maxLength={20}
        autoFocus={isReauth}
      />
      {!isReauth && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox id="rememberMe" name="rememberMe" />
          자동 로그인 유지
        </label>
      )}

      {/* mt-auto: 여기서부터 아래(에러·CTA·링크)는 화면 하단에 붙는다 */}
      <div className="mt-auto flex flex-col gap-2 pt-6">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          disabled={pending}
          className={cn(
            "h-[52px] rounded-lg text-base font-bold",
            pending && "disabled:bg-primary disabled:text-primary-foreground"
          )}
        >
          {pending ? (
            <Spinner className="size-5" />
          ) : isReauth ? (
            "확인"
          ) : (
            "로그인"
          )}
        </Button>
      </div>
      {!isReauth && (
        <div className="flex items-center justify-center gap-4 text-sm">
          <Link
            href={`/find-id${
              redirectTo
                ? `?${new URLSearchParams({ redirect_to: redirectTo }).toString()}`
                : ""
            }`}
            className="rounded-md px-1 py-2 text-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            아이디 찾기
          </Link>
          <span className="h-3 w-px bg-border" aria-hidden />
          <Link
            href={`/forgot-password${
              redirectTo
                ? `?${new URLSearchParams({ redirect_to: redirectTo }).toString()}`
                : ""
            }`}
            className="rounded-md px-1 py-2 text-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            비밀번호 찾기
          </Link>
        </div>
      )}
      <Button
        asChild
        variant="ghost"
        className="h-11 text-sm text-muted-foreground"
      >
        {isReauth ? (
          <Link
            href={`/signin${
              redirectTo
                ? `?${new URLSearchParams({ redirect_to: redirectTo }).toString()}`
                : ""
            }`}
          >
            다른 계정으로 로그인
          </Link>
        ) : (
          <Link
            href={`/?${redirectTo ? new URLSearchParams({ redirect_to: redirectTo }).toString() : ""}`}
          >
            계정 리스트로 돌아가기
          </Link>
        )}
      </Button>
    </form>
  )
}
