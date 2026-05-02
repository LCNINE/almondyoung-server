import "server-only";

export type PromptValue = "none" | "login" | "select_account" | "consent";

const VALID_PROMPTS: ReadonlySet<PromptValue> = new Set([
  "none",
  "login",
  "select_account",
  "consent",
]);

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  scope?: string;
  responseType: "code";
  prompt?: PromptValue;
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
  const promptRaw = get("prompt");

  if (!clientId) return { ok: false, error: "client_id required" };
  if (!redirectUri) return { ok: false, error: "redirect_uri required" };
  if (!state) return { ok: false, error: "state required" };
  if (!codeChallenge) return { ok: false, error: "code_challenge required" };
  if (codeChallengeMethod !== "S256") return { ok: false, error: "code_challenge_method must be S256" };
  if (responseType !== "code") return { ok: false, error: "response_type must be code" };

  // 표준 외 prompt 값은 무시(OIDC: unknown prompt는 무시 가능).
  const prompt = promptRaw && VALID_PROMPTS.has(promptRaw as PromptValue)
    ? (promptRaw as PromptValue)
    : undefined;

  // client_id / redirect_uri 등록 여부는 user-service /oauth/internal/issue-code 가 검증한다.
  // auth-web 은 형태(필수 필드, S256, response_type=code) 만 본다.

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
      prompt,
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
  if (params.prompt) sp.set("prompt", params.prompt);
  return `/oauth/authorize?${sp.toString()}`;
}

// OIDC error response: redirect_uri로 302 + error/error_description/state.
export function buildErrorRedirect(
  redirectUri: string,
  state: string,
  error: "login_required" | "consent_required" | "interaction_required" | "server_error" | "access_denied",
  description?: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  url.searchParams.set("state", state);
  return url.toString();
}
