"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { signUpAction } from "@/app/actions";
import { PhoneNumberInput } from "@/components/phone-number-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useEmailAvailability } from "@/hooks/use-email-availability";

export function SignUpForm({ redirectTo }: { redirectTo: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const emailAvailability = useEmailAvailability(email);
  const emailTaken = emailAvailability.status === "taken";

  const onSubmit = (formData: FormData) => {
    if (emailTaken) {
      setError("이미 사용 중인 이메일입니다. 다른 이메일을 입력해주세요.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await signUpAction(formData);
      if (res && !res.ok) setError(res.error);
    });
  };

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <Field>
        <FieldLabel htmlFor="loginId">아이디</FieldLabel>
        <Input
          id="loginId"
          name="loginId"
          required
          minLength={4}
          maxLength={20}
          pattern="[a-z0-9]+"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="password">비밀번호</FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={20}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="passwordConfirm">비밀번호 확인</FieldLabel>
        <Input
          id="passwordConfirm"
          name="passwordConfirm"
          type="password"
          required
          minLength={8}
          maxLength={20}
        />
      </Field>
      <Field data-invalid={emailTaken || undefined}>
        <FieldLabel htmlFor="email">이메일</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={emailTaken || undefined}
          aria-describedby="emailStatus"
        />
        <EmailStatus state={emailAvailability} />
      </Field>
      <Field>
        <FieldLabel htmlFor="username">이름</FieldLabel>
        <Input
          id="username"
          name="username"
          required
          minLength={2}
          maxLength={8}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="nickname">닉네임</FieldLabel>
        <Input
          id="nickname"
          name="nickname"
          required
          minLength={2}
          maxLength={8}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="birthday">생년월일</FieldLabel>
        <Input id="birthday" name="birthday" type="date" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="phoneNumber">휴대폰 번호</FieldLabel>
        <PhoneNumberInput
          id="phoneNumber"
          name="phoneNumber"
          required
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="010-1234-5678"
          aria-describedby="phoneNumberHelp"
        />
        <p id="phoneNumberHelp" className="text-xs text-muted-foreground">
          숫자만 입력하면 자동으로 형식이 적용되고, 가입 요청 시 기본 국가코드
          +82가 사용됩니다.
        </p>
      </Field>

      <fieldset className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
        <legend className="px-1 text-xs font-medium text-muted-foreground">
          동의 항목
        </legend>
        <Consent name="isOver14" label="만 14세 이상입니다 (필수)" required />
        <Consent name="termsOfService" label="이용약관 동의 (필수)" required />
        <Consent
          name="electronicTransaction"
          label="전자금융거래 이용약관 동의 (필수)"
          required
        />
        <Consent
          name="privacyPolicy"
          label="개인정보 처리방침 동의 (필수)"
          required
        />
        <Consent
          name="thirdPartySharing"
          label="제3자 정보제공 동의 (필수)"
          required
        />
        <Consent name="marketingConsent" label="마케팅 정보 수신 동의 (선택)" />
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending || emailTaken}>
        {pending ? "가입 중..." : "가입하기"}
      </Button>
      <Button asChild variant="ghost" size="sm">
        <Link
          href={`/?${redirectTo ? new URLSearchParams({ redirect_to: redirectTo }).toString() : ""}`}
        >
          계정 리스트로 돌아가기
        </Link>
      </Button>
    </form>
  );
}

function EmailStatus({
  state,
}: {
  state: ReturnType<typeof useEmailAvailability>;
}) {
  switch (state.status) {
    case "checking":
      return (
        <FieldDescription id="emailStatus">
          이메일 사용 가능 여부 확인 중...
        </FieldDescription>
      );
    case "available":
      return (
        <FieldDescription id="emailStatus" className="text-emerald-600">
          사용 가능한 이메일입니다.
        </FieldDescription>
      );
    case "taken":
      return (
        <FieldError id="emailStatus">이미 사용 중인 이메일입니다.</FieldError>
      );
    case "invalid":
    case "error":
      return <FieldError id="emailStatus">{state.message}</FieldError>;
    default:
      return null;
  }
}

function Consent({
  name,
  label,
  required,
}: {
  name: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <Checkbox id={name} name={name} required={required} />
      {label}
    </label>
  );
}
