import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * admin-web 자체가 OIDC RP. parent-domain 쿠키 공유는 더 이상 사용하지 않으며,
 * IdP (user-service + auth-web) 와의 통신은 표준 OIDC code+PKCE+nonce 흐름으로 한다.
 *
 * - issuerUrl: user-service base URL. `${issuerUrl}/.well-known/openid-configuration`,
 *   `${issuerUrl}/oauth/token` 등이 여기서 파생된다.
 * - authorizationUrl: auth-web 의 `/oauth/authorize`. user-service 디스커버리에 명시된
 *   `authorization_endpoint` 값과 동일해야 한다 (auth-web origin 기반).
 * - clientId/clientSecret: user-service `oauth_clients` 테이블에 등록된 confidential client.
 * - redirectUri/postLogoutRedirectUri: 클라이언트 등록 시 화이트리스트된 URI 와 정확히 일치.
 */
export const oidcEnv = {
  issuerUrl: required("OIDC_ISSUER_URL"),
  authorizationUrl: required("OIDC_AUTHORIZATION_URL"),
  clientId: required("OIDC_CLIENT_ID"),
  clientSecret: required("OIDC_CLIENT_SECRET"),
  redirectUri: required("OIDC_REDIRECT_URI"),
  postLogoutRedirectUri: required("OIDC_POST_LOGOUT_REDIRECT_URI"),
  scope: process.env.OIDC_SCOPE ?? "openid profile email offline_access",
  jwksUrl: required("OAUTH_JWKS_URL"),
};
