export interface OidcConfig {
  issuer: string;
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface OidcEndpoints {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
}

export async function discover(
  issuer: string,
  getJson: (url: string) => Promise<unknown>
): Promise<OidcEndpoints> {
  const doc = (await getJson(
    `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  )) as OidcEndpoints;
  return doc;
}

export function buildAuthorizeUrl(
  cfg: OidcConfig,
  p: { state: string; nonce: string; challenge: string }
): string {
  const url = new URL(cfg.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('state', p.state);
  url.searchParams.set('nonce', p.nonce);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export function buildEndSessionUrl(
  cfg: Pick<OidcConfig, 'authorizationEndpoint' | 'clientId'>,
  idToken?: string
): string {
  const url = new URL('/oauth/end_session', cfg.authorizationEndpoint);
  url.searchParams.set('client_id', cfg.clientId);
  if (idToken) url.searchParams.set('id_token_hint', idToken);

  return url.toString();
}

export function parseCallback(url: string): { code: string; state: string } {
  const u = new URL(url);
  const error = u.searchParams.get('error');
  if (error) throw new Error(`OIDC callback error: ${error}`);
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code || !state) throw new Error('OIDC callback missing code/state');
  return { code, state };
}

export interface WorkerIdentity {
  id: string;
  name: string;
  loginId?: string;
}

/** OIDC userinfo 응답에서 화면에 보일 작업자 이름과 로그인 아이디를 고른다. */
export function parseUserInfo(raw: unknown): WorkerIdentity {
  const text = (key: string) => {
    const value: unknown =
      raw && typeof raw === 'object' ? Reflect.get(raw, key) : undefined;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  const id = text('sub');
  const loginId = text('preferred_username');
  const name = text('name') ?? text('nickname') ?? loginId;
  if (!id || !name) throw new Error('userinfo missing sub/name');
  return { id, name, ...(loginId && loginId !== name && { loginId }) };
}
