import { z } from 'zod';

const oauthClientSchema = z.object({
  clientId: z.string().min(1),
  clientSecretHash: z.string().min(1),
  redirectUris: z.array(z.string().url()).min(1),
  allowedScopes: z.array(z.string()).optional(),
});

const oauthClientsSchema = z.array(oauthClientSchema);

export type OAuthClientConfig = z.infer<typeof oauthClientSchema>;

// TEMP: 시연용 bypass 모드에서 사용되는 기본 clientId.
export const DEMO_BYPASS_CLIENT_ID = '00000000-0000-0000-0000-000000000000';

let cached: OAuthClientConfig[] | null = null;

export function loadOAuthClients(raw: string | undefined): OAuthClientConfig[] {
  if (cached) return cached;
  if (!raw) {
    cached = [];
    return cached;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`OAUTH_CLIENTS must be valid JSON: ${(e as Error).message}`);
  }
  const result = oauthClientsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`OAUTH_CLIENTS schema invalid: ${JSON.stringify(result.error.flatten())}`);
  }
  cached = result.data;
  return cached;
}

export function findOAuthClient(clientId: string, raw: string | undefined): OAuthClientConfig | null {
  const clients = loadOAuthClients(raw);
  return clients.find((c) => c.clientId === clientId) ?? null;
}

export function isRedirectUriRegistered(client: OAuthClientConfig, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}
