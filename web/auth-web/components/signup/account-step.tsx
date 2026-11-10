"use client"

import * as React from "react"

import { PasswordInput } from "@/components/password-input"
import type { StepValues } from "@/components/signup/types"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError } from "@/components/ui/field"
import {
  FloatingLabelInput,
  floatingInputClass,
} from "@/components/ui/floating-label-input"
import {
  useEmailAvailability,
  useLoginIdAvailability,
  type AvailabilityState,
} from "@/hooks/use-availability"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

const PASSWORD_RULE = "영문, 숫자, 특수문자를 각각 1개 이상 포함해 8~20자"
const LOGIN_ID_RULE = "영문 소문자와 숫자만, 4~20자"

export function AccountStep({
  defaultValues,
  onNext,
  onBack,
}: {
  defaultValues: StepValues
  onNext: (values: StepValues) => void
  onBack: () => void
}) {
  const [loginId, setLoginId] = React.useState(defaultValues.loginId ?? "")
  const [email, setEmail] = React.useState(defaultValues.email ?? "")
  const [touched, setTouched] = React.useState({ loginId: false, email: false })
  const loginIdAvailability = withFormatError(
    useLoginIdAvailability(loginId),
    touched.loginId && loginId.trim() !== "",
    `아이디는 ${LOGIN_ID_RULE}로 입력해주세요.`
  )
  const emailAvailability = withFormatError(
    useEmailAvailability(email),
    touched.email && email.trim() !== "",
    "이메일 주소를 정확히 입력해주세요."
  )
  const loginIdRejected = isRejected(loginIdAvailability)
  const emailRejected = isRejected(emailAvailability)
  // 중복확인이 끝나기 전에 넘어가면 중복인 채로 마지막 스텝까지 가서야 실패한다.
  const unconfirmed =
    !isConfirmed(loginIdAvailability) || !isConfirmed(emailAvailability)
  const [mismatch, setMismatch] = React.useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (fd.get("password") !== fd.get("passwordConfirm")) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    onNext(Object.fromEntries(fd) as StepValues)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4">
      <Field data-invalid={loginIdRejected || undefined}>
        <FloatingLabelInput
          id="loginId"
          name="loginId"
          label="아이디"
          clearable
          required
          minLength={4}
          maxLength={20}
          pattern="[a-z0-9]+"
          autoCapitalize="off"
          autoComplete="username"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, loginId: true }))}
          aria-invalid={loginIdRejected || undefined}
          aria-describedby="loginIdStatus"
          onInvalid={(e) =>
            e.currentTarget.setCustomValidity(
              `아이디는 ${LOGIN_ID_RULE}로 입력해주세요.`
            )
          }
          onInput={(e) => e.currentTarget.setCustomValidity("")}
        />
        <AvailabilityStatus
          id="loginIdStatus"
          state={loginIdAvailability}
          idleText={LOGIN_ID_RULE}
          availableText="사용 가능한 아이디입니다."
          takenText="이미 사용 중인 아이디입니다."
          checkingText="아이디 사용 가능 여부 확인 중..."
        />
      </Field>

      <PasswordInput
        id="password"
        name="password"
        label="비밀번호"
        clearable
        placeholder=" "
        className={floatingInputClass}
        defaultValue={defaultValues.password}
        required
        minLength={8}
        maxLength={20}
        autoComplete="new-password"
        pattern={`(?=.*[a-zA-Z])(?=.*\\d)(?=.*[!@#$%^&*()_+\\-=\\[\\]{};':"\\\\|,.<>\\/?]).+`}
        onInvalid={(e) =>
          e.currentTarget.setCustomValidity(
            `비밀번호는 ${PASSWORD_RULE}로 입력해주세요.`
          )
        }
        onInput={(e) => e.currentTarget.setCustomValidity("")}
      />

      {/* 규칙 안내는 두 칸을 함께 설명하므로 확인칸 밑에 한 번만 둔다. */}
      <Field data-invalid={mismatch || undefined}>
        <PasswordInput
          id="passwordConfirm"
          name="passwordConfirm"
          label="비밀번호 확인"
          clearable
          placeholder=" "
          className={floatingInputClass}
          defaultValue={defaultValues.passwordConfirm}
          required
          minLength={8}
          maxLength={20}
          autoComplete="new-password"
          aria-invalid={mismatch || undefined}
          aria-describedby="passwordHelp"
          onInput={() => setMismatch(false)}
        />
        {mismatch ? (
          <FieldError>비밀번호가 일치하지 않습니다.</FieldError>
        ) : (
          <FieldDescription id="passwordHelp" className="text-xs">
            {PASSWORD_RULE}
          </FieldDescription>
        )}
      </Field>

      <Field data-invalid={emailRejected || undefined}>
        <FloatingLabelInput
          id="email"
          name="email"
          type="email"
          label="이메일"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          aria-invalid={emailRejected || undefined}
          aria-describedby="emailStatus"
        />
        <AvailabilityStatus
          id="emailStatus"
          state={emailAvailability}
          availableText="사용 가능한 이메일입니다."
          takenText="이미 사용 중인 이메일입니다."
          checkingText="이메일 사용 가능 여부 확인 중..."
        />
      </Field>

      <StepFooter onBack={onBack} nextDisabled={unconfirmed} />
    </form>
  )
}

/**
 * 형식이 틀린 값은 훅이 서버를 부르지 않고 idle 로 둔다. 입력칸을 한 번 떠난 뒤에도 idle 이면 형식 오류다.
 * 첫 글자부터 빨갛게 뜨지 않도록 blur 전에는 규칙 안내만 보인다.
 */
function withFormatError(
  state: AvailabilityState,
  shouldShow: boolean,
  message: string
): AvailabilityState {
  if (shouldShow && state.status === "idle")
    return { status: "invalid", message }

  return state
}

function isRejected(state: AvailabilityState) {
  return state.status === "taken" || state.status === "invalid"
}

/**
 * 중복확인이 끝났고 넘어가도 되는 상태인지.
 * error 는 확인 API 장애라 여기서 막으면 가입 자체가 불가능해진다 — 서버가 가입 시점에 다시 검증한다.
 */
export function isConfirmed(state: AvailabilityState) {
  return state.status === "available" || state.status === "error"
}

export function AvailabilityStatus({
  id,
  state,
  idleText,
  availableText,
  takenText,
  checkingText,
}: {
  id: string
  state: AvailabilityState
  /** 아직 확인할 수 없는 값일 때 자리를 채우는 안내(입력 규칙). 없으면 아무것도 안 보인다. */
  idleText?: string
  availableText: string
  takenText: string
  checkingText: string
}) {
  switch (state.status) {
    case "checking":
      return (
        <FieldDescription id={id} className="text-xs">
          {checkingText}
        </FieldDescription>
      )
    case "available":
      return (
        <FieldDescription id={id} className="text-xs text-[#079171]">
          {availableText}
        </FieldDescription>
      )
    case "taken":
      return (
        <FieldError id={id} className="text-xs">
          {takenText}
        </FieldError>
      )
    case "invalid":
    case "error":
      return (
        <FieldError id={id} className="text-xs">
          {state.message}
        </FieldError>
      )
    default:
      return idleText ? (
        <FieldDescription id={id} className="text-xs">
          {idleText}
        </FieldDescription>
      ) : null
  }
}

export function StepFooter({
  onBack,
  nextDisabled,
  nextLabel = "다음",
  pending,
}: {
  onBack: () => void
  nextDisabled?: boolean
  nextLabel?: string
  pending?: boolean
}) {
  return (
    <div className="mt-auto flex gap-2 pt-6">
      <Button
        type="button"
        variant="secondary"
        onClick={onBack}
        className="h-[52px] flex-1 rounded-lg text-base font-bold"
      >
        이전
      </Button>
      <Button
        type="submit"
        disabled={nextDisabled || pending}
        className={cn(
          "h-[52px] flex-[2] rounded-lg text-base font-bold",
          // 전송 중 disabled 는 로딩이므로 브랜드색을 유지해 로더가 읽히게 한다
          pending && "disabled:bg-primary disabled:text-primary-foreground"
        )}
      >
        {pending ? <Spinner className="size-5" /> : nextLabel}
      </Button>
    </div>
  )
}
