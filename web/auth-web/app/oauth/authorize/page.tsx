import { redirect } from "next/navigation";

import {
  buildAuthorizeUrl,
  parseAuthorizeParams,
} from "@/lib/oauth-params";
import { env } from "@/lib/env";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const raw = await searchParams;
  const parsed = parseAuthorizeParams(raw);

  if (!parsed.ok) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-4 px-6 py-12">
        <h1 className="text-xl font-semibold">잘못된 요청</h1>
        <p className="text-sm text-muted-foreground">{parsed.error}</p>
      </main>
    );
  }

  const params = parsed.value;
  const back = `${env.selfOrigin}${buildAuthorizeUrl(params)}`;
  const huburl = `/?redirect_to=${encodeURIComponent(back)}`;
  redirect(huburl);
}
