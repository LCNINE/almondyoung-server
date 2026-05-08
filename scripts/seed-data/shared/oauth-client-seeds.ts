import type { OAuthClientSeed } from '../seeders/03-user-service.seeder';

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
  const storefrontBase = process.env.STOREFRONT_BASE_URL;
  if (storefrontBase) {
    seeds.push({
      clientId: 'medusa-storefront',
      clientType: 'confidential',
      redirectUris: [`${storefrontBase}/kr/callback/oidc`],
      postLogoutRedirectUris: [`${storefrontBase}/kr`],
      allowedScopes: ['openid', 'profile', 'email'],
      clientSecret: process.env.STOREFRONT_OIDC_CLIENT_SECRET,
    });
  }

  return seeds;
}
