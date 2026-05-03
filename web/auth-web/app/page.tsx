import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountList } from "@/components/account-list";
import { Button } from "@/components/ui/button";
import { listAccounts } from "@/lib/account-store";
import { hasIdpRefreshToken } from "@/lib/idp-session";
import { decodeJwtPayload } from "@/lib/jwt";
import { sanitizeRedirectTo } from "@/lib/redirect";

type SearchParams = Promise<{
  redirect_to?: string;
  edit?: string;
  force_login?: string;
}>;

export default async function AccountHubPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const redirectTo = sanitizeRedirectTo(params.redirect_to) ?? "";
  const editing = params.edit === "1";

  // prompt=login (authorize → /?force_login=1) → 계정 선택 건너뛰고 signin.
  if (params.force_login === "1") {
    const qs = new URLSearchParams();
    if (redirectTo) qs.set("redirect_to", redirectTo);
    redirect(`/signin?${qs.toString()}`);
  }

  const accounts = await listAccounts();
  const idpRt = await hasIdpRefreshToken();
  const activeUserId = idpRt
    ? decodeJwtPayload<{ sub: string }>(idpRt)?.sub ?? null
    : null;

  const qs = new URLSearchParams();
  if (redirectTo) qs.set("redirect_to", redirectTo);
  const signinHref = `/signin?${qs.toString()}`;
  const signupHref = `/signup?${qs.toString()}`;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">계정 선택</h1>
        <p className="text-sm text-muted-foreground">
          계속 진행할 계정을 선택하거나 다른 계정으로 로그인하세요.
        </p>
      </header>

      <AccountList
        accounts={accounts}
        activeUserId={activeUserId}
        redirectTo={redirectTo}
        editing={editing}
      />

      <div className="flex flex-col gap-2">
        <Button asChild variant="outline">
          <Link href={signinHref}>다른 계정으로 로그인</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href={signupHref}>새로 가입하기</Link>
        </Button>
        {accounts.length > 0 && (
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/?${new URLSearchParams({ ...(redirectTo ? { redirect_to: redirectTo } : {}), ...(editing ? {} : { edit: "1" }) }).toString()}`}
            >
              {editing ? "편집 완료" : "편집"}
            </Link>
          </Button>
        )}
      </div>
    </main>
  );
}
