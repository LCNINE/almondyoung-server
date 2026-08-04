"use client"

import * as React from "react"

import { sendRecoveryCodeAction } from "@/app/actions"
import { BirthdayInput } from "@/components/birthday-input"
import { PhoneNumberInput } from "@/components/phone-number-input"
import {
  AvailabilityStatus,
  StepFooter,
  isConfirmed,
} from "@/components/signup/account-step"
import type { StepValues } from "@/components/signup/types"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { NICKNAME_RULE, useNicknameAvailability } from "@/hooks/use-availability"
import {
  FloatingField,
  FloatingLabelInput,
  floatingInputClass,
} from "@/components/ui/floating-label-input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export function ProfileStep({
  defaultValues,
  onSubmit,
  onBack,
  pending,
}: {
  defaultValues: StepValues
  onSubmit: (values: StepValues) => void
  onBack: () => void
  pending: boolean
}) {
  const formRef = React.useRef<HTMLFormElement>(null)
  const [nickname, setNickname] = React.useState(defaultValues.nickname ?? "")
  const nicknameAvailability = useNicknameAvailability(nickname)
  const isNicknameInvalid =
    nicknameAvailability.status === "taken" ||
    nicknameAvailability.status === "invalid"
  const [codeSent, setCodeSent] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [sendError, setSendError] = React.useState<string | null>(null)
  const [sendMessage, setSendMessage] = React.useState<string | null>(null)

  const sendCode = async () => {
    const form = formRef.current
    if (!form) return
    setSending(true)
    setSendError(null)
    setSendMessage(null)
    const fd = new FormData(form)
    const res = await sendRecoveryCodeAction(fd)
    setSending(false)
    if (res.ok) {
      setCodeSent(true)
      setSendMessage(res.message)
    } else {
      setSendError(res.error)
    }
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    onSubmit(Object.fromEntries(new FormData(e.currentTarget)) as StepValues)
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col gap-4"
    >
      <FloatingLabelInput
        id="username"
        name="username"
        label="이름"
        defaultValue={defaultValues.username}
        required
        minLength={2}
        maxLength={8}
        autoComplete="name"
      />
      <Field data-invalid={isNicknameInvalid || undefined}>
        <FloatingLabelInput
          id="nickname"
          name="nickname"
          label="닉네임"
          required
          minLength={2}
          maxLength={8}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          aria-invalid={isNicknameInvalid || undefined}
          aria-describedby="nicknameStatus"
        />
        <AvailabilityStatus
          id="nicknameStatus"
          state={nicknameAvailability}
          idleText={NICKNAME_RULE}
          availableText="사용 가능한 닉네임입니다."
          takenText="이미 사용 중인 닉네임입니다."
          checkingText="닉네임 사용 가능 여부 확인 중..."
        />
      </Field>

      <Field>
        {/* 셀렉트 3개라 라벨이 떠오를 자리가 없다 — 여기만 일반 라벨을 쓴다. */}
        <FieldLabel htmlFor="birthday">생년월일</FieldLabel>
        <BirthdayInput
          id="birthday"
          name="birthday"
          defaultValue={defaultValues.birthday}
          required
        />
      </Field>

      <div className="flex items-start gap-2">
        <FloatingField
          htmlFor="phoneNumber"
          label="휴대폰 번호"
          className="flex-1"
        >
          <PhoneNumberInput
            id="phoneNumber"
            name="phoneNumber"
            defaultValue={defaultValues.phoneNumber}
            required
            placeholder=" "
            className={floatingInputClass}
            inputMode="numeric"
            autoComplete="tel-national"
          />
        </FloatingField>
        <Button
          type="button"
          variant={codeSent ? "outline" : "default"}
          onClick={sendCode}
          disabled={sending}
          className={cn(
            "h-14 shrink-0 rounded-lg px-4",
            sending && "disabled:bg-primary disabled:text-primary-foreground"
          )}
        >
          {sending ? (
            <Spinner className="size-5" />
          ) : codeSent ? (
            "재발송"
          ) : (
            "인증번호 받기"
          )}
        </Button>
      </div>

      {codeSent && (
        <FloatingLabelInput
          id="code"
          name="code"
          label="인증번호 6자리"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="\d{6}"
          onInvalid={(e) =>
            e.currentTarget.setCustomValidity("인증번호 6자리를 입력해주세요.")
          }
          onInput={(e) => e.currentTarget.setCustomValidity("")}
        />
      )}
      {sendMessage && (
        <FieldDescription className="text-[#079171]">
          {sendMessage}
        </FieldDescription>
      )}
      {sendError && (
        <FieldDescription className="text-destructive">
          {sendError}
        </FieldDescription>
      )}

      <StepFooter
        onBack={onBack}
        nextLabel="가입하기"
        nextDisabled={!codeSent || !isConfirmed(nicknameAvailability)}
        pending={pending}
      />
      {!codeSent && (
        <p className="text-center text-xs text-muted-foreground">
          휴대폰 인증을 완료해야 가입할 수 있습니다.
        </p>
      )}
    </form>
  )
}
