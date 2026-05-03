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

  return seeds;
}

seedUserService(databaseUrl, adminPassword, { oauthClients: buildOAuthClientSeeds() })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
