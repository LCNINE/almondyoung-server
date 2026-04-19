import Link from "next/link";

import { Button } from "@/components/ui/button";
import { sanitizeRedirectTo } from "@/lib/redirect";

type SearchParams = Promise<{ email?: string; redirect_to?: string }>;

export default async function SignUpPendingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const email = params.email ?? "";
  const redirectTo = sanitizeRedirectTo(params.redirect_to) ?? "";
  const qs = new URLSearchParams();
  if (redirectTo) qs.set("redirect_to", redirectTo);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">이메일을 확인해주세요</h1>
        <p className="text-sm text-muted-foreground">
          {email ? (
            <>
              <span className="font-medium">{email}</span> 로 인증 메일을 보냈습니다.
              메일의 링크를 눌러 가입을 완료하세요.
            </>
          ) : (
            "가입 시 입력한 이메일로 인증 메일을 보냈습니다. 메일의 링크를 눌러 가입을 완료하세요."
          )}
        </p>
      </header>
      <Button asChild variant="outline">
        <Link href={`/?${qs.toString()}`}>계정 리스트로 돌아가기</Link>
      </Button>
    </main>
  );
}
