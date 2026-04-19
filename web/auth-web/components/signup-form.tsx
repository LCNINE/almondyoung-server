"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { signUpAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function SignUpForm({ redirectTo }: { redirectTo: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (formData: FormData) => {
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
        <Input id="loginId" name="loginId" required minLength={4} maxLength={20} pattern="[a-z0-9]+" />
      </Field>
      <Field>
        <FieldLabel htmlFor="password">비밀번호</FieldLabel>
        <Input id="password" name="password" type="password" required minLength={8} maxLength={20} />
      </Field>
      <Field>
        <FieldLabel htmlFor="email">이메일</FieldLabel>
        <Input id="email" name="email" type="email" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="username">이름</FieldLabel>
        <Input id="username" name="username" required minLength={2} maxLength={8} />
      </Field>
      <Field>
        <FieldLabel htmlFor="nickname">닉네임</FieldLabel>
        <Input id="nickname" name="nickname" required minLength={2} maxLength={8} />
      </Field>
      <Field>
        <FieldLabel htmlFor="birthday">생년월일</FieldLabel>
        <Input id="birthday" name="birthday" type="date" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="phoneNumber">휴대폰 번호 (E.164, 예: +821012345678)</FieldLabel>
        <Input id="phoneNumber" name="phoneNumber" required pattern="\+[1-9]\d{1,14}" />
      </Field>

      <fieldset className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
        <legend className="px-1 text-xs font-medium text-muted-foreground">동의 항목</legend>
        <Consent name="isOver14" label="만 14세 이상입니다 (필수)" required />
        <Consent name="termsOfService" label="이용약관 동의 (필수)" required />
        <Consent name="electronicTransaction" label="전자금융거래 이용약관 동의 (필수)" required />
        <Consent name="privacyPolicy" label="개인정보 처리방침 동의 (필수)" required />
        <Consent name="thirdPartySharing" label="제3자 정보제공 동의 (필수)" required />
        <Consent name="marketingConsent" label="마케팅 정보 수신 동의 (선택)" />
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "가입 중..." : "가입하기"}
      </Button>
      <Button asChild variant="ghost" size="sm">
        <Link href={`/?${redirectTo ? new URLSearchParams({ redirect_to: redirectTo }).toString() : ""}`}>
          계정 리스트로 돌아가기
        </Link>
      </Button>
    </form>
  );
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
