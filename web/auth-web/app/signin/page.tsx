import { SignInForm } from "@/components/signin-form";
import { sanitizeRedirectTo } from "@/lib/redirect";

type SearchParams = Promise<{
  redirect_to?: string;
  login_id?: string;
  reauth_user_id?: string;
}>;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const redirectTo = sanitizeRedirectTo(params.redirect_to) ?? "";
  const prefilledLoginId = (params.login_id ?? "").trim();
  const reauthUserId = (params.reauth_user_id ?? "").trim();
  const isReauth = reauthUserId.length > 0;
  // 재인증인데 loginId 를 알면 어느 계정의 비밀번호를 묻는지 명시한다. loginId 를 모르는
  // (옛 메타 쿠키) 경우만 일반 안내 문구로 폴백.
  const reauthSubtitle = prefilledLoginId
    ? `${prefilledLoginId} 계정의 비밀번호를 다시 입력해주세요.`
    : "보안을 위해 비밀번호를 다시 입력해주세요.";

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">
          {isReauth ? "비밀번호 재입력" : "로그인"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isReauth ? reauthSubtitle : "아이디와 비밀번호를 입력해주세요."}
        </p>
      </header>
      <SignInForm
        redirectTo={redirectTo}
        prefilledLoginId={prefilledLoginId}
        reauthUserId={reauthUserId}
      />
    </main>
  );
}
