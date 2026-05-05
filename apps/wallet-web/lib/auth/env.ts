import 'server-only';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * wallet-web 자체가 OIDC RP. IdP (user-service + auth-web) 와의 통신은 표준
 * OIDC code+PKCE+nonce 흐름이며, 세션 쿠키는 host-only 로 발급한다 (admin-web 패턴).
 *
 * - issuerUrl: user-service base URL. `${issuerUrl}/oauth/token`, JWKS 가 여기서 파생.
 * - authorizationUrl: auth-web 의 `/oauth/authorize`.
 * - clientId/clientSecret: user-service `oauth_clients` 테이블에 'wallet-web' 으로 등록된 confidential client.
 * - redirectUri/postLogoutRedirectUri: 클라이언트 등록 시 화이트리스트와 정확히 일치.
 */
export const oidcEnv = {
  issuerUrl: required('OIDC_ISSUER_URL'),
  authorizationUrl: required('OIDC_AUTHORIZATION_URL'),
  clientId: required('OIDC_CLIENT_ID'),
  clientSecret: required('OIDC_CLIENT_SECRET'),
  redirectUri: required('OIDC_REDIRECT_URI'),
  postLogoutRedirectUri: required('OIDC_POST_LOGOUT_REDIRECT_URI'),
  // user-service `oauth_clients.allowedScopes` 와 매칭되는 값만 보낼 것.
  // 시드 default 는 ["openid","email","profile"]. offline_access 등 추가 스코프는 시드에서 명시 후 OIDC_SCOPE 로 override.
  scope: process.env.OIDC_SCOPE ?? 'openid profile email',
  jwksUrl: required('OAUTH_JWKS_URL'),
};
