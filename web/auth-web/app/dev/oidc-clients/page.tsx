import { notFound, redirect } from "next/navigation";

import { Toaster } from "@/components/ui/sonner";
import { env } from "@/lib/env";
import { probeListOAuthClients } from "@/lib/user-service-admin";

import { DevOidcClientsClient } from "./dev-oidc-clients-client";
import { NoMasterScopeNotice } from "./no-master-scope";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!env.devToolsEnabled) notFound();

  const probe = await probeListOAuthClients();

  if (probe.kind === "unauthenticated") {
    redirect("/signin?next=/dev/oidc-clients");
  }

  if (probe.kind === "forbidden") {
    return (
      <main className="container mx-auto max-w-3xl space-y-6 p-8">
        <Header />
        <NoMasterScopeNotice />
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-5xl space-y-8 p-8">
      <Header />
      <DevOidcClientsClient initialClients={probe.clients} />
      <Toaster />
    </main>
  );
}

function Header() {
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold">OIDC Client (dev tools)</h1>
      <p className="text-sm text-muted-foreground">
        dev stage 전용 화면입니다. 등록된 client_secret 은 생성/회전 직후 1회만 표시되며, 다시 조회할 수 없습니다.
      </p>
    </header>
  );
}
