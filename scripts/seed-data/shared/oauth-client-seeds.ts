import type { OAuthClientSeed } from '../seeders/03-user-service.seeder';

/**
 * 쇼핑몰 Android 앱(native/storefront-app)의 redirect URI 2종.
 *
 * 앱 소스의 상수와 **문자 단위로 일치해야 한다** — user-service 의 redirect_uri 매칭은
 * 커스텀 스킴에 대해 exact match 만 허용한다(apps/user-service/src/api/oauth/redirect-uri.ts).
 *   APP_LOGIN     ↔ native/storefront-app/src/auth/pkce-login.ts  APP_LOGIN_REDIRECT
 *   APP_WEBVIEW   ↔ native/storefront-app/src/login/callback.ts   WEBVIEW_LOGIN_REDIRECT
 *
 * 이 값들은 admin API(`POST/PATCH /admin/oauth-clients`)로는 등록할 수 없다 — DTO 의
 * `@IsUrl` 이 http/https/ftp 만 통과시켜 커스텀 스킴을 거부한다. 그래서 시드가 유일한
 * 등록 경로다.
 */
export const STOREFRONT_APP_LOGIN_REDIRECT = 'almondyoung://oauth/callback';
export const STOREFRONT_APP_WEBVIEW_REDIRECT = 'almondyoung://callback/oidc';

/**
 * 앱 자체 public client (PKCE). 다른 RP 와 달리 base URL 이 없는 고정 커스텀 스킴이라
 * env gate 없이 항상 시드한다. public client 이므로 secret 은 발급되지 않는다.
 */
export const STOREFRONT_APP_CLIENT_SEED: OAuthClientSeed = {
  clientId: 'almondyoung-android-app',
  clientType: 'public',
  redirectUris: [STOREFRONT_APP_LOGIN_REDIRECT],
  allowedScopes: ['openid', 'profile', 'email'],
};

export function buildOAuthClientSeeds(): OAuthClientSeed[] {
  const seeds: OAuthClientSeed[] = [];

  const adminWebBase = process.env.ADMIN_WEB_BASE_URL;
  if (adminWebBase) {
    seeds.push({
      clientId: 'admin-web',
      clientType: 'confidential',
      redirectUris: [`${adminWebBase}/auth/callback`],
      postLogoutRedirectUris: [`${adminWebBase}/login`],
      allowedScopes: ['openid', 'profile', 'email', 'offline_access'],
      clientSecret: process.env.ADMIN_WEB_OIDC_CLIENT_SECRET,
    });
  }

  const walletWebBase = process.env.WALLET_WEB_BASE_URL;
  if (walletWebBase) {
    seeds.push({
      clientId: 'wallet-web',
      clientType: 'confidential',
      redirectUris: [`${walletWebBase}/auth/callback`],
      postLogoutRedirectUris: [walletWebBase],
      allowedScopes: ['openid', 'profile', 'email'],
      clientSecret: process.env.WALLET_WEB_OIDC_CLIENT_SECRET,
    });
  }

  // storefront(=medusa-storefront RP). country 추가 시 redirectUris 배열에 추가.
  // 앱 웹뷰 로그인도 이 client 를 쓴다 — Medusa 의 user-service-sso 가 앱이 보낸
  // callback_url 을 그대로 redirect_uri 로 넣어 authorize URL 을 만들기 때문이다.
  const storefrontBase = process.env.STOREFRONT_BASE_URL;
  if (storefrontBase) {
    seeds.push({
      clientId: 'medusa-storefront',
      clientType: 'confidential',
      redirectUris: [`${storefrontBase}/kr/callback/oidc`, STOREFRONT_APP_WEBVIEW_REDIRECT],
      postLogoutRedirectUris: [`${storefrontBase}/kr`],
      allowedScopes: ['openid', 'profile', 'email'],
      clientSecret: process.env.STOREFRONT_OIDC_CLIENT_SECRET,
    });
  }

  seeds.push(STOREFRONT_APP_CLIENT_SEED);

  return seeds;
}
