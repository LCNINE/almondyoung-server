import { completeSignupCallback } from "@/app/actions";
import { SignupCallbackClient } from "@/components/signup-callback-client";

type SearchParams = Promise<{ userId?: string; redirect_to?: string }>;

/**
 * user-service가 이메일 인증 후 리다이렉트하는 랜딩 페이지.
 * userId를 받아 서버에서 /auth/callback/signup 호출 → 토큰 발급 → 쿠키 저장 → redirect_to로 이동.
 */
export default async function SignupCallbackPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const userId = params.userId ?? "";
  const redirectTo = params.redirect_to ?? "";
  if (!userId) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-4 px-6 py-12">
        <h1 className="text-xl font-semibold">잘못된 요청</h1>
        <p className="text-sm text-muted-foreground">userId 파라미터가 없습니다.</p>
      </main>
    );
  }
  return <SignupCallbackClient userId={userId} redirectTo={redirectTo} action={completeSignupCallback} />;
}
