#!/usr/bin/env ts-node
/**
 * Hard purge Channel Adapter state produced by Core/PIM -> Medusa backfills.
 *
 * This does not touch Medusa. It clears local mapping/progress/failure rows so
 * a fresh Medusa in-process backfill can be followed by sync-mappings without
 * stale product IDs from a previous run.
 *
 * Usage:
 *   yarn migrate:purge-backfill-state
 *   PURGE_DRY_RUN=false PURGE_CONFIRM=purge-pim-medusa-backfill-state yarn migrate:purge-backfill-state
 */
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { channelAdapterSchema, migrationFailures, migrationProgress, pimMedusaMappings } from '../src/schema';

const CONFIRM_VALUE = 'purge-pim-medusa-backfill-state';

function isDryRun(): boolean {
  return process.env.PURGE_DRY_RUN !== 'false';
}

function requireConfirmation(dryRun: boolean): void {
  if (!dryRun && process.env.PURGE_CONFIRM !== CONFIRM_VALUE) {
    throw new Error(`Set PURGE_CONFIRM=${CONFIRM_VALUE} and PURGE_DRY_RUN=false to hard-delete rows.`);
  }
}

async function countRows(db: ReturnType<typeof drizzle>, table: any): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int4` }).from(table);
  return row?.count ?? 0;
}

async function main() {
  const dryRun = isDryRun();
  requireConfirmation(dryRun);

  if (!process.env.DATABASE_URL) {
    throw new Error('Missing env: DATABASE_URL');
  }

  const client = (postgres as any).default
    ? (postgres as any).default(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 60 })
    : (postgres as any)(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 60 });
  const db = drizzle(client, { schema: channelAdapterSchema });

  try {
    const mappingCount = await countRows(db, pimMedusaMappings);
    const progressCount = await countRows(db, migrationProgress);
    const failureCount = await countRows(db, migrationFailures);

    console.log(`[purge-backfill-state] ${dryRun ? 'DRY RUN' : 'HARD DELETE'}`);
    console.log(`[purge-backfill-state] Target pim_medusa_mappings: ${mappingCount}`);
    console.log(`[purge-backfill-state] Target migration_progress: ${progressCount}`);
    console.log(`[purge-backfill-state] Target migration_failures: ${failureCount}`);

    if (dryRun) {
      console.log('[purge-backfill-state] Dry-run complete. No rows deleted.');
      return;
    }

    await db.delete(migrationFailures);
    await db.delete(migrationProgress);
    await db.delete(pimMedusaMappings);

    console.log('[purge-backfill-state] Done.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ purge-pim-medusa-backfill-state failed:', err);
  process.exit(1);
});
