#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import * as path from 'path';
import { seedUserService, type OAuthClientSeed } from './seeders/03-user-service.seeder';

dotenv.config({ path: path.join(__dirname, '.env') });

const databaseUrl = process.env.USER_SERVICE_DATABASE_URL;
const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@1234!';

if (!databaseUrl) {
  console.error('❌ USER_SERVICE_DATABASE_URL is required in scripts/seed-data/.env');
  process.exit(1);
}

function buildOAuthClientSeeds(): OAuthClientSeed[] {
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

  // storefront(=medusa-storefront RP). 콜백 경로: `${BASE}/${countryCode}/callback/oidc`
  // (web/almondyoung-storefront/src/lib/api/medusa/sso.ts 의 buildCallbackUrl 과 동치).
  // 운영 country 가 kr 단일이라 한 개만 등록. country 추가 시 redirectUris 배열에 추가하면 됨.
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

seedUserService(databaseUrl, adminPassword, { oauthClients: buildOAuthClientSeeds() })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
