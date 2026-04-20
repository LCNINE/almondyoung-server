"use server";

import { redirect } from "next/navigation";

import { issueOAuthCodeInternal } from "@/lib/user-service";
import {
  AuthorizeParams,
} from "@/lib/oauth-params";

export async function issueOAuthCodeAction(
  userId: string,
  params: AuthorizeParams,
): Promise<void> {
  const { code } = await issueOAuthCodeInternal({
    clientId: params.clientId,
    userId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: "S256",
    scope: params.scope,
  });

  const url = new URL(params.redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("state", params.state);
  redirect(url.toString());
}
