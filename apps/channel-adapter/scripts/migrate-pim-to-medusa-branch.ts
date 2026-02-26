#!/usr/bin/env ts-node
/**
 * PIM -> Medusa migration script (no input snapshot persistence).
 *
 * Intended for isolated Medusa DB branch runs.
 *
 * Usage:
 *   PIM_SOURCE_DB_URL=... DATABASE_URL=... MEDUSA_API_URL=... MEDUSA_API_KEY=... \
 *   npx ts-node -r tsconfig-paths/register apps/channel-adapter/scripts/migrate-pim-to-medusa-branch.ts
 *
 * Options:
 *   --batch-size=100
 *   --limit=1000
 *   --offset=0
 *   --only-missing-inventory
 *   --dry-run
 *
 * Extra env for --only-missing-inventory:
 *   MEDUSA_DB_URL=... (direct Medusa DB connection string)
 */

import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ConfigService } from '@nestjs/config';
import { channelAdapterSchema } from '../src/schema';
import { PimSnapshotBuilder } from './lib/pim-snapshot-builder';
import { PimMedusaSyncService } from '../src/adapters/medusa/pim-medusa-sync.service';
import { MedusaClient } from '../src/adapters/medusa/medusa.client';
import { PimMedusaMappingRepository } from '../src/adapters/medusa/pim-medusa-mapping.repository';

interface Args {
  batchSize: number;
  limit?: number;
  offset: number;
  onlyMissingInventory: boolean;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const getValue = (name: string): string | undefined =>
    args.find((v) => v.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  const batchSize = Number(getValue('batch-size') || '100');
  const limitRaw = getValue('limit');
  const offset = Number(getValue('offset') || '0');
  const onlyMissingInventory = args.includes('--only-missing-inventory');
  const dryRun = args.includes('--dry-run');

  if (Number.isNaN(batchSize) || batchSize <= 0) {
    throw new Error('--batch-size must be a positive number');
  }
  if (Number.isNaN(offset) || offset < 0) {
    throw new Error('--offset must be a non-negative number');
  }

  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limit !== undefined && (Number.isNaN(limit) || limit <= 0)) {
    throw new Error('--limit must be a positive number');
  }

  return {
    batchSize,
    limit,
    offset,
    onlyMissingInventory,
    dryRun,
  };
}

function requireEnv(required: string[]): void {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing env: ${missing.join(', ')}`);
  }
}

async function needsInventoryBackfill(
  medusaDb: postgres.Sql,
  handle: string,
): Promise<{ needsBackfill: boolean; reason: string }> {
  const rows = await medusaDb<{
    product_id: string;
    variant_cnt: number;
    managed_true_cnt: number;
    linked_cnt: number;
  }[]>`
    SELECT
      p.id AS product_id,
      COUNT(v.variant_id)::int AS variant_cnt,
      COALESCE(SUM(CASE WHEN v.manage_inventory_true THEN 1 ELSE 0 END), 0)::int AS managed_true_cnt,
      COALESCE(SUM(CASE WHEN v.has_link THEN 1 ELSE 0 END), 0)::int AS linked_cnt
    FROM product p
    LEFT JOIN LATERAL (
      SELECT
        pv.id AS variant_id,
        (pv.manage_inventory = true) AS manage_inventory_true,
        EXISTS(
          SELECT 1
          FROM product_variant_inventory_item pvii
          WHERE pvii.variant_id = pv.id
        ) AS has_link
      FROM product_variant pv
      WHERE pv.product_id = p.id
    ) v ON TRUE
    WHERE p.handle = ${handle}
    GROUP BY p.id
    LIMIT 1
  `;

  const row = rows[0];
  if (!row?.product_id) {
    return { needsBackfill: true, reason: 'product_not_found_in_medusa_db' };
  }

  if (row.variant_cnt === 0) {
    return { needsBackfill: true, reason: 'no_variants' };
  }

  if (row.managed_true_cnt < row.variant_cnt) {
    return { needsBackfill: true, reason: 'manage_inventory_false' };
  }

  if (row.linked_cnt < row.variant_cnt) {
    return { needsBackfill: true, reason: 'missing_inventory_item_link' };
  }

  return { needsBackfill: false, reason: 'already_synced_db_verified' };
}

async function main(): Promise<void> {
  const options = parseArgs();

  requireEnv(['PIM_SOURCE_DB_URL', 'DATABASE_URL']);
  if (!options.dryRun || options.onlyMissingInventory) {
    requireEnv(['MEDUSA_API_URL', 'MEDUSA_API_KEY']);
  }
  if (options.onlyMissingInventory) {
    requireEnv(['MEDUSA_DB_URL']);
  }

  console.log('🚀 PIM -> Medusa migration (branch)');
  console.log(`   batchSize=${options.batchSize}`);
  console.log(`   offset=${options.offset}`);
  if (options.limit) {
    console.log(`   limit=${options.limit}`);
  }
  console.log(`   onlyMissingInventory=${options.onlyMissingInventory}`);
  console.log(`   mode=${options.dryRun ? 'dry-run' : 'write'}`);

  const pimDb = postgres(process.env.PIM_SOURCE_DB_URL!, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const snapshotBuilder = new PimSnapshotBuilder(pimDb);

  const channelDbClient = postgres(process.env.DATABASE_URL!);
  const channelDb = drizzle(channelDbClient, { schema: channelAdapterSchema });

  const configService = new ConfigService({
    MEDUSA_API_URL: process.env.MEDUSA_API_URL,
    MEDUSA_API_KEY: process.env.MEDUSA_API_KEY,
    MEDUSA_MEMBERSHIP_GROUP_ID: process.env.MEDUSA_MEMBERSHIP_GROUP_ID,
    FILE_SERVICE_URL: process.env.FILE_SERVICE_URL,
  });

  const medusaClient = new MedusaClient(configService);
  const mappingRepo = new PimMedusaMappingRepository({ db: channelDb } as any);
  const syncService = new PimMedusaSyncService(medusaClient, mappingRepo);
  const medusaDbClient = options.onlyMissingInventory
    ? postgres(process.env.MEDUSA_DB_URL!, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
    })
    : null;

  let offset = options.offset;
  let processed = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let stopRequested = false;

  const requestStop = () => {
    if (!stopRequested) {
      stopRequested = true;
      console.log('\n🛑 Stop requested. Finishing current item...');
    }
  };
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);

  try {
    while (true) {
      if (options.limit && processed >= options.limit) {
        break;
      }

      const snapshots = await snapshotBuilder.fetchActiveMasters(options.batchSize, offset);
      if (snapshots.length === 0) {
        break;
      }

      for (let i = 0; i < snapshots.length; i++) {
        if (options.limit && processed >= options.limit) {
          break;
        }

        const snapshot = snapshots[i];
        const seq = processed + 1;

        try {
          if (options.onlyMissingInventory) {
            const check = await needsInventoryBackfill(medusaDbClient!, snapshot.masterId);
            if (!check.needsBackfill) {
              skipped += 1;
              console.log(`⏭️  [${seq}] ${snapshot.masterId} v${snapshot.version} (skip: ${check.reason})`);
              processed += 1;
              if (stopRequested) {
                break;
              }
              continue;
            }
          }

          if (!options.dryRun) {
            await syncService.syncFromSnapshot(snapshot, {
              skipCategorySync: options.onlyMissingInventory,
            });
          }
          success += 1;
          console.log(`✅ [${seq}] ${snapshot.masterId} v${snapshot.version}`);
        } catch (error: any) {
          failed += 1;
          console.error(`❌ [${seq}] ${snapshot.masterId} v${snapshot.version}: ${error?.message || error}`);
        }

        processed += 1;
        if (stopRequested) {
          break;
        }
      }

      if (stopRequested) {
        break;
      }

      offset += options.batchSize;
    }
  } finally {
    await snapshotBuilder.close();
    if (medusaDbClient) {
      await medusaDbClient.end();
    }
    await channelDbClient.end();
  }

  console.log('\n=== Migration finished ===');
  console.log(`Processed: ${processed}`);
  console.log(`Success:   ${success}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Skipped:   ${skipped}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
