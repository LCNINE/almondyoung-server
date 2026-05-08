#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import * as path from 'path';
import { seedUserService } from './seeders/03-user-service.seeder';
import { buildOAuthClientSeeds } from './shared/oauth-client-seeds';

dotenv.config({ path: path.join(__dirname, '.env') });

const databaseUrl = process.env.USER_SERVICE_DATABASE_URL;
const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@1234!';

if (!databaseUrl) {
  console.error('❌ USER_SERVICE_DATABASE_URL is required in scripts/seed-data/.env');
  process.exit(1);
}

seedUserService(databaseUrl, adminPassword, { oauthClients: buildOAuthClientSeeds() })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
