import Link from "next/link";

import { completeSignupCallback } from "@/app/actions";
import { SignupCallbackClient } from "@/components/signup-callback-client";
import { Button } from "@/components/ui/button";
import { sanitizeRedirectTo } from "@/lib/redirect";

type SearchParams = Promise<{ signup_token?: string; redirect_to?: string }>;

/**
 * 두 진입점:
 *   1) signUp 직후 — server action 흐름 안에서 자동으로 처리되므로 보통 이 페이지를 직접 거치지 않는다.
 *      (e2e 등에서 외부 호출이 들어올 수 있어 signupToken 경로는 유지)
 *   2) verify-email 후 리다이렉트 — signup_token 없이 redirect_to 만 옴. 이메일 인증이 완료되었음을
 *      알리고 redirect_to 로 이동시킨다. (verify-email 은 더 이상 자동 로그인 토큰을 발급하지 않는다)
 *
 * userId 를 직접 받아 토큰을 발급하던 이전 동작은 보안상 제거됨.
 */
export default async function SignupCallbackPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const signupToken = params.signup_token ?? "";
  const safeRedirect = sanitizeRedirectTo(params.redirect_to);

  if (signupToken) {
    return (
      <SignupCallbackClient
        signupToken={signupToken}
        redirectTo={safeRedirect ?? ""}
        action={completeSignupCallback}
      />
    );
  }

  // verify-email 경로: 토큰은 없지만 인증은 완료된 상태. 안내만 보여준다.
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-12">
      <h1 className="text-xl font-semibold">이메일 인증이 완료되었습니다</h1>
      <p className="text-sm text-muted-foreground">계속 진행하려면 로그인해 주세요.</p>
      <Button asChild>
        <Link href={safeRedirect ?? "/"}>{safeRedirect ? "이어서 진행" : "홈으로"}</Link>
      </Button>
    </main>
  );
}
