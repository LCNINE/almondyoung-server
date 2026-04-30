import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

type OAuthClientRegistryEntry = {
  clientId: string;
  redirectUris: string[];
};

function parseOAuthClients(raw: string): OAuthClientRegistryEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`OAUTH_ALLOWED_CLIENTS must be JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error("OAUTH_ALLOWED_CLIENTS must be an array");
  return parsed.map((c: any, i: number) => {
    if (!c || typeof c.clientId !== "string" || !Array.isArray(c.redirectUris)) {
      throw new Error(`OAUTH_ALLOWED_CLIENTS[${i}] invalid shape`);
    }
    return { clientId: c.clientId, redirectUris: c.redirectUris.map(String) };
  });
}

export const env = {
  userServiceUrl: required("USER_SERVICE_URL"),
  parentCookieDomain: required("PARENT_COOKIE_DOMAIN"),
  parentCookieSecure: optional("PARENT_COOKIE_SECURE", "true") === "true",
  parentCookieSameSite: optional("PARENT_COOKIE_SAMESITE", "lax") as
    | "lax"
    | "none"
    | "strict",
  allowedRedirectHosts: optional("ALLOWED_REDIRECT_HOSTS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  oauthInternalSecret: optional("OAUTH_INTERNAL_SECRET", ""),
  oauthAllowedClients: parseOAuthClients(optional("OAUTH_ALLOWED_CLIENTS", "")),
  selfOrigin: required("AUTH_WEB_ORIGIN"),
  // TEMP: 내부 시연용. true면 redirect host / oauth client / redirect_uri 검증을 모두 우회한다.
  // 시연 끝나면 env에서 제거할 것.
  oauthBypassValidation: optional("OAUTH_BYPASS_VALIDATION", "false") === "true",
};

export const DEMO_BYPASS_CLIENT_ID = "00000000-0000-0000-0000-000000000000";
