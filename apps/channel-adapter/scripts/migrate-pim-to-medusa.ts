#!/usr/bin/env ts-node

// ========================================================================
// PIMCLIENT: MIGRATION SCRIPT ONLY
// ========================================================================
// This script is allowed to use PimClient for direct PIM API access.
// This is an exception to the MSA boundary rule and should ONLY be used for:
// - One-time data migration/backfill operations
// - Administrative/debugging tasks
// - NOT for regular operational code
// ========================================================================

/**
 * PIM → Medusa full migration/backfill.
 * - Pulls active masters from PIM (Medusa sales channel mapped masters).
 * - Upserts into Medusa via PimMedusaSyncService.
 * Usage:
 *   PIM_API_URL=... MEDUSA_API_URL=... MEDUSA_API_KEY=... MEDUSA_MEMBERSHIP_GROUP_ID=... \
 *   DATABASE_URL=... \
 *   npx ts-node -r tsconfig-paths/register apps/channel-adapter/scripts/migrate-pim-to-medusa.ts [--masters id1,id2] [--limit N]
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ConfigService } from '@nestjs/config';
import { channelAdapterSchema } from '../src/schema';
import { PimClient } from '../src/adapters/medusa/pim.client';
import { MedusaClient } from '../src/adapters/medusa/medusa.client';
import { PimMedusaMappingRepository } from '../src/adapters/medusa/pim-medusa-mapping.repository';
import { PimMedusaSyncService } from '../src/adapters/medusa/pim-medusa-sync.service';

type Args = {
  masters?: string[];
  limit?: number;
  offset?: number;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const args: Args = {};
  for (const item of raw) {
    if (item.startsWith('--masters=')) {
      args.masters = item.replace('--masters=', '').split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (item.startsWith('--limit=')) {
      args.limit = parseInt(item.replace('--limit=', ''), 10);
    }
    if (item.startsWith('--offset=')) {
      args.offset = parseInt(item.replace('--offset=', ''), 10);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();

  const requiredEnv = ['PIM_API_URL', 'MEDUSA_API_URL', 'MEDUSA_API_KEY', 'DATABASE_URL'];
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      throw new Error(`Missing env: ${key}`);
    }
  }

  const configService = new ConfigService({
    PIM_API_URL: process.env.PIM_API_URL,
    MEDUSA_API_URL: process.env.MEDUSA_API_URL,
    MEDUSA_API_KEY: process.env.MEDUSA_API_KEY,
    FILE_SERVICE_URL: process.env.FILE_SERVICE_URL || 'http://dummy.com',
    MEDUSA_MEMBERSHIP_GROUP_ID: process.env.MEDUSA_MEMBERSHIP_GROUP_ID || undefined,
  });

  // Initialize database with drizzle directly
  const dbClient = postgres(process.env.DATABASE_URL!);
  const db = drizzle(dbClient, { schema: channelAdapterSchema });

  const pimClient = new PimClient(configService);
  const medusaClient = new MedusaClient(configService);
  const mappingRepo = new PimMedusaMappingRepository({ db } as any);
  const syncService = new PimMedusaSyncService(medusaClient, mappingRepo);

  // 캐시 초기화
  console.log('Clearing all caches to ensure fresh sync...');
  medusaClient.clearAllCaches();

  const masters = args.masters?.length
    ? args.masters
    : process.env.PIM_SOURCE_DB_URL
      ? await getMastersFromDb(process.env.PIM_SOURCE_DB_URL)
      : await pimClient.getAllActiveMasters();
  const start = args.offset || 0;
  const targets = masters.slice(start, args.limit ? start + args.limit : undefined);

  console.log(`🔄 Starting migration: ${targets.length} masters (of ${masters.length})`);

  const results: any[] = [];
  for (const masterId of targets) {
    try {
      // Get snapshot from PIM API and use syncFromSnapshot
      const snapshot = await pimClient.getActiveVersion(masterId);
      if (!snapshot || !snapshot.versionId) {
        console.log(`⏭️ ${masterId}: No active version, skipping`);
        results.push({ success: true, masterId, action: 'skipped' });
        continue;
      }
      const res = await syncService.syncFromSnapshot(snapshot);
      results.push(res);
      console.log(`✅ ${masterId} -> ${res.medusaProductId || res.action}`);
    } catch (err: any) {
      console.error(`❌ ${masterId}:`, err?.message || err);
      results.push({ success: false, masterId, error: err?.message || 'unknown' });
    }
  }

  const success = results.filter((r: any) => r.success).length;
  const failed = results.length - success;
  console.log(`\n=== Migration finished ===`);
  console.log(`Total: ${results.length}, Success: ${success}, Failed: ${failed}`);

  await dbClient.end();
}

async function getMastersFromDb(dbUrl: string): Promise<string[]> {
  console.log(`Fetching active masters directly from DB: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);
  const sql = postgres(dbUrl, { max: 1 });
  try {
    const rows = await sql<{ masterId: string }[]>`
      SELECT DISTINCT pmv.master_id AS "masterId"
      FROM product_master_versions pmv
      INNER JOIN product_masters pm ON pm.id = pmv.master_id
      WHERE pmv.status = 'active'
        AND pmv.deleted_at IS NULL
        AND pm.deleted_at IS NULL
    `;
    console.log(`DB returned ${rows.length} active masters.`);
    return rows.map((r) => r.masterId);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
