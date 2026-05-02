"use client";

import { useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import type { ActionResult } from "@/app/actions";

type Action = (signupToken: string, redirectTo: string) => Promise<ActionResult>;

export function SignupCallbackClient({
  signupToken,
  redirectTo,
  action,
}: {
  signupToken: string;
  redirectTo: string;
  action: Action;
}) {
  const ran = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    action(signupToken, redirectTo).then((res) => {
      if (res && !res.ok) setError(res.error);
    });
  }, [action, signupToken, redirectTo]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-12">
      {error ? (
        <>
          <h1 className="text-xl font-semibold">가입 완료 처리 실패</h1>
          <p className="text-sm text-destructive">{error}</p>
        </>
      ) : (
        <>
          <Spinner />
          <p className="text-sm text-muted-foreground">가입을 완료하는 중...</p>
        </>
      )}
    </main>
  );
}
