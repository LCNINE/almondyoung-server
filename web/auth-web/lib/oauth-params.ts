import "server-only";

import { env } from "./env";

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  scope?: string;
  responseType: "code";
};

export type AuthorizeParseResult =
  | { ok: true; value: AuthorizeParams }
  | { ok: false; error: string };

export function parseAuthorizeParams(raw: Record<string, string | string[] | undefined>): AuthorizeParseResult {
  const get = (k: string): string | undefined => {
    const v = raw[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const clientId = get("client_id");
  const redirectUri = get("redirect_uri");
  const state = get("state");
  const codeChallenge = get("code_challenge");
  const codeChallengeMethod = get("code_challenge_method");
  const responseType = get("response_type");
  const scope = get("scope");

  if (!clientId) return { ok: false, error: "client_id required" };
  if (!redirectUri) return { ok: false, error: "redirect_uri required" };
  if (!state) return { ok: false, error: "state required" };
  if (!codeChallenge) return { ok: false, error: "code_challenge required" };
  if (codeChallengeMethod !== "S256") return { ok: false, error: "code_challenge_method must be S256" };
  if (responseType !== "code") return { ok: false, error: "response_type must be code" };

  const client = env.oauthAllowedClients.find((c) => c.clientId === clientId);
  if (!client) return { ok: false, error: "unknown client_id" };
  if (!client.redirectUris.includes(redirectUri)) {
    return { ok: false, error: "redirect_uri not registered for client" };
  }

  return {
    ok: true,
    value: {
      clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod: "S256",
      scope,
      responseType: "code",
    },
  };
}

export function buildAuthorizeUrl(params: AuthorizeParams): string {
  const sp = new URLSearchParams();
  sp.set("client_id", params.clientId);
  sp.set("redirect_uri", params.redirectUri);
  sp.set("state", params.state);
  sp.set("code_challenge", params.codeChallenge);
  sp.set("code_challenge_method", params.codeChallengeMethod);
  sp.set("response_type", "code");
  if (params.scope) sp.set("scope", params.scope);
  return `/oauth/authorize?${sp.toString()}`;
}
