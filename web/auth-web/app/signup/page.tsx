import { SignUpForm } from "@/components/signup-form";
import { sanitizeRedirectTo } from "@/lib/redirect";

type SearchParams = Promise<{ redirect_to?: string }>;

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const redirectTo = sanitizeRedirectTo(params.redirect_to) ?? "";
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">회원가입</h1>
        <p className="text-sm text-muted-foreground">
          가입 후 이메일 인증을 완료해야 로그인이 활성화됩니다.
        </p>
      </header>
      <SignUpForm redirectTo={redirectTo} />
    </main>
  );
}
