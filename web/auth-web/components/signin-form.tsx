"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { signInAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await signInAction(formData);
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
          autoComplete="username"
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
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={20}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox id="rememberMe" name="rememberMe" />
        자동 로그인 유지
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "로그인 중..." : "로그인"}
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
