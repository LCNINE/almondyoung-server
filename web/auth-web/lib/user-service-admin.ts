import "server-only";

import { ApiError, readApiData, throwIfBad } from "./api-helpers";
import { env } from "./env";
import { getIdpAccessToken } from "./idp-session";

export type OAuthClientType = "confidential" | "public";

export type OAuthClient = {
  clientId: string;
  clientType: OAuthClientType;
  redirectUris: string[];
  postLogoutRedirectUris: string[] | null;
  allowedScopes: string[] | null;
  isActive: boolean;
  hasPreviousSecret: boolean;
  secretRotatedAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OAuthClientWithSecret = OAuthClient & {
  /** 생성/회전 직후 1회만 평문으로 노출. public client는 null. */
  clientSecret: string | null;
};

export type CreateOAuthClientInput = {
  clientId: string;
  clientType?: OAuthClientType;
  redirectUris: string[];
  postLogoutRedirectUris?: string[];
  allowedScopes?: string[];
};

export type UpdateOAuthClientInput = {
  redirectUris?: string[];
  postLogoutRedirectUris?: string[];
  allowedScopes?: string[];
  isActive?: boolean;
};

export class NotAuthenticatedError extends Error {
  constructor() {
    super("auth-web 세션이 없습니다.");
    this.name = "NotAuthenticatedError";
  }
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getIdpAccessToken();
  if (!token) throw new NotAuthenticatedError();

  const baseHeaders: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
  return fetch(`${env.userServiceUrl}${path}`, {
    ...init,
    headers: { ...baseHeaders, ...(init?.headers as Record<string, string> | undefined) },
    cache: "no-store",
  });
}

export async function listOAuthClients(): Promise<OAuthClient[]> {
  const res = await authedFetch("/admin/oauth-clients", { method: "GET" });
  await throwIfBad(res, "list-oauth-clients");
  return readApiData<OAuthClient[]>(res);
}

export async function createOAuthClient(
  input: CreateOAuthClientInput,
): Promise<OAuthClientWithSecret> {
  const res = await authedFetch("/admin/oauth-clients", {
    method: "POST",
    body: JSON.stringify(input),
  });
  await throwIfBad(res, "create-oauth-client");
  return readApiData<OAuthClientWithSecret>(res);
}

export async function updateOAuthClient(
  clientId: string,
  patch: UpdateOAuthClientInput,
): Promise<OAuthClient> {
  const res = await authedFetch(`/admin/oauth-clients/${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  await throwIfBad(res, "update-oauth-client");
  return readApiData<OAuthClient>(res);
}

export async function rotateOAuthClientSecret(
  clientId: string,
): Promise<OAuthClientWithSecret> {
  const res = await authedFetch(
    `/admin/oauth-clients/${encodeURIComponent(clientId)}/rotate-secret`,
    { method: "POST" },
  );
  await throwIfBad(res, "rotate-oauth-client-secret");
  return readApiData<OAuthClientWithSecret>(res);
}

export async function clearPreviousOAuthClientSecret(clientId: string): Promise<OAuthClient> {
  const res = await authedFetch(
    `/admin/oauth-clients/${encodeURIComponent(clientId)}/clear-previous-secret`,
    { method: "POST" },
  );
  await throwIfBad(res, "clear-previous-oauth-client-secret");
  return readApiData<OAuthClient>(res);
}

export async function deactivateOAuthClient(clientId: string): Promise<OAuthClient> {
  const res = await authedFetch(`/admin/oauth-clients/${encodeURIComponent(clientId)}`, {
    method: "DELETE",
  });
  await throwIfBad(res, "deactivate-oauth-client");
  return readApiData<OAuthClient>(res);
}

/** 권한 가드용 — 401 / 403 / 인증부재 셋을 구분 가능한 형태로 반환. */
export type ListProbeResult =
  | { kind: "ok"; clients: OAuthClient[] }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" };

export async function probeListOAuthClients(): Promise<ListProbeResult> {
  try {
    const clients = await listOAuthClients();
    return { kind: "ok", clients };
  } catch (err) {
    if (err instanceof NotAuthenticatedError) return { kind: "unauthenticated" };
    if (err instanceof ApiError) {
      if (err.status === 401) return { kind: "unauthenticated" };
      if (err.status === 403) return { kind: "forbidden" };
    }
    throw err;
  }
}
