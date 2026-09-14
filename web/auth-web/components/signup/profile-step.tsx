"use client"

import * as React from "react"

import { sendRecoveryCodeAction } from "@/app/actions"
import { BirthdayInput } from "@/components/birthday-input"
import { MessageCircle } from "lucide-react"
import { PhoneNumberInput } from "@/components/phone-number-input"
import {
  AvailabilityStatus,
  StepFooter,
  isConfirmed,
} from "@/components/signup/account-step"
import type { StepValues } from "@/components/signup/types"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  NICKNAME_RULE,
  useNicknameAvailability,
} from "@/hooks/use-availability"
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
  // 어느 채널을 보내는 중인지까지 들고 있어야 한다. 참/거짓 하나면 카카오톡을 누를 때
  // 문자 재발송 버튼까지 로딩 상태로 바뀐다.
  const [sending, setSending] = React.useState<null | "SMS" | "KAKAO">(null)
  const [sendError, setSendError] = React.useState<string | null>(null)
  const [sendMessage, setSendMessage] = React.useState<string | null>(null)

  const sendCode = async (channel?: "KAKAO") => {
    const form = formRef.current
    if (!form) return
    setSending(channel ?? "SMS")
    setSendError(null)
    setSendMessage(null)
    const fd = new FormData(form)
    if (channel) fd.set("channel", channel)
    const res = await sendRecoveryCodeAction(fd)
    setSending(null)
    if (res.ok) {
      // 새 코드를 발급받았으므로 입력칸에 남은 옛 코드를 지운다. 그대로 두면 고객이 방금 받은
      // 코드 대신 만료된 코드를 제출하게 된다.
      const codeInput = form.elements.namedItem("code")
      if (codeInput instanceof HTMLInputElement) codeInput.value = ""

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
          onClick={() => sendCode()}
          disabled={sending !== null}
          className={cn(
            // 최소 너비를 잡는다. 내용이 「인증번호 받기」 → 스피너 → 「재발송」 으로 바뀌는데
            // 너비를 내용에 맡기면 그때마다 옆 입력칸이 늘었다 줄어 화면이 흔들린다.
            // 고정(w-)이 아니라 최소(min-w-)인 이유: 문구가 길어지면 넘치는 대신 늘어나야 한다.
            "h-14 min-w-[132px] shrink-0 rounded-lg px-4",
            sending === "SMS" &&
              "disabled:bg-primary disabled:text-primary-foreground"
          )}
        >
          {sending === "SMS" ? (
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
      {codeSent && (
        <div className="flex items-center justify-between gap-3">
          <FieldDescription>문자가 오지 않나요?</FieldDescription>
          <button
            type="button"
            onClick={() => sendCode("KAKAO")}
            disabled={sending !== null}
            className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-[#FEE500] px-4 text-sm font-medium text-[#191600] transition-colors hover:bg-[#F2DA00] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MessageCircle className="size-4 fill-current" strokeWidth={0} />
            {sending === "KAKAO" ? "보내는 중…" : "카카오톡으로 받기"}
          </button>
        </div>
      )}
      {/*
        결과 문구는 조건부로 붙였다 떼면 발송할 때마다 아래 내용이 밀렸다 당겨져 화면이 흔들린다.
        자리를 항상 차지하게 두고 내용만 바꾼다.
      */}
      <FieldDescription
        className={cn(
          "min-h-5",
          sendError ? "text-destructive" : "text-[#079171]"
        )}
        role={sendError ? "alert" : undefined}
      >
        {sendError ?? sendMessage ?? ""}
      </FieldDescription>

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
