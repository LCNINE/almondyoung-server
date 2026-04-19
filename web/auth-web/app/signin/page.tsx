import { SignInForm } from "@/components/signin-form";
import { sanitizeRedirectTo } from "@/lib/redirect";

type SearchParams = Promise<{ redirect_to?: string }>;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const redirectTo = sanitizeRedirectTo(params.redirect_to) ?? "";
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">로그인</h1>
        <p className="text-sm text-muted-foreground">
          아이디와 비밀번호를 입력해주세요.
        </p>
      </header>
      <SignInForm redirectTo={redirectTo} />
    </main>
  );
}
