"use client"

import Link from "next/link"
import { useState, useTransition } from "react"

import { signInAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

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

  const onSubmit = (formData: FormData) => {
    setError(null)
    startTransition(async () => {
      const res = await signInAction(formData)
      if (res && !res.ok) setError(res.error)
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input type="hidden" name="reauthUserId" value={reauthUserId} />
      {hasPrefilledLoginId ? (
        <input type="hidden" name="loginId" value={prefilledLoginId} />
      ) : (
        <Field>
          <FieldLabel htmlFor="loginId">아이디</FieldLabel>
          <Input
            id="loginId"
            name="loginId"
            autoComplete="username"
            required
            minLength={4}
            maxLength={20}
            pattern="[a-z0-9]+"
            defaultValue={prefilledLoginId}
          />
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="password">비밀번호</FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={20}
          autoFocus={isReauth}
        />
      </Field>
      {!isReauth && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox id="rememberMe" name="rememberMe" />
          자동 로그인 유지
        </label>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "로그인 중..." : isReauth ? "확인" : "로그인"}
      </Button>
      {!isReauth && (
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link
              href={`/find-id${
                redirectTo
                  ? `?${new URLSearchParams({ redirect_to: redirectTo }).toString()}`
                  : ""
              }`}
            >
              아이디 찾기
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link
              href={`/forgot-password${
                redirectTo
                  ? `?${new URLSearchParams({ redirect_to: redirectTo }).toString()}`
                  : ""
              }`}
            >
              비밀번호 찾기
            </Link>
          </Button>
        </div>
      )}
      {isReauth ? (
        <Button asChild variant="ghost" size="sm">
          <Link
            href={`/signin${
              redirectTo
                ? `?${new URLSearchParams({ redirect_to: redirectTo }).toString()}`
                : ""
            }`}
          >
            다른 계정으로 로그인
          </Link>
        </Button>
      ) : (
        <Button asChild variant="ghost" size="sm">
          <Link
            href={`/?${redirectTo ? new URLSearchParams({ redirect_to: redirectTo }).toString() : ""}`}
          >
            계정 리스트로 돌아가기
          </Link>
        </Button>
      )}
    </form>
  )
}
