#!/usr/bin/env ts-node
// apps/channel-adapter/scripts/verify-migration.ts
/**
 * Verify Migration Data Integrity
 *
 * Compares PIM active masters count with synced Channel Adapter mappings
 * to verify migration completeness
 *
 * Usage:
 *   # Basic verification
 *   CORE_DB_URL=postgres://... DATABASE_URL=... \
 *   npx ts-node apps/channel-adapter/scripts/verify-migration.ts
 *
 *   # Detailed verification (shows missing masters)
 *   npx ts-node apps/channel-adapter/scripts/verify-migration.ts --detailed
 */

import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { channelAdapterSchema, pimMedusaMappings } from '../src/schema';
import { eq, sql } from 'drizzle-orm';

/**
 * Parse command-line arguments
 */
function parseArgs(): { detailed: boolean } {
  const args = process.argv.slice(2);
  const detailedFlag = args.includes('--detailed');

  return {
    detailed: detailedFlag,
  };
}

/**
 * Validate environment variables
 */
function validateEnv(): void {
  const required = ['CORE_DB_URL', 'DATABASE_URL'];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    process.exit(1);
  }
}

/**
 * Main verification function
 */
async function main() {
  console.log('🔍 Migration Data Integrity Verification\n');

  // Parse arguments
  const options = parseArgs();

  // Validate environment
  validateEnv();

  // Initialize Core (구 PIM) database connection (READ-ONLY)
  console.log('🔌 Connecting to Core database...');
  const pimDb = postgres(process.env.CORE_DB_URL!, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  // Initialize Channel Adapter database
  console.log('🔌 Connecting to Channel Adapter database...\n');
  const channelDbClient = postgres(process.env.DATABASE_URL!);
  const channelDb = drizzle(channelDbClient, { schema: channelAdapterSchema });

  try {
    console.log('📊 Counting products...\n');

    // Count PIM active masters
    const pimCountResult = await pimDb<Array<{ count: string }>>`
      SELECT COUNT(*) AS count
      FROM product_masters pm
      INNER JOIN product_master_versions pmv ON pm.id = pmv.master_id
      WHERE pmv.status = 'active'
        AND pmv.deleted_at IS NULL
        AND pm.deleted_at IS NULL
    `;
    const pimCount = Number(pimCountResult[0].count);

    // Count synced mappings in Channel Adapter
    const syncedCountResult = await channelDb
      .select({ count: sql<number>`count(*)` })
      .from(pimMedusaMappings)
      .where(eq(pimMedusaMappings.syncStatus, 'synced'));
    const syncedCount = syncedCountResult[0].count;

    // Count pending/failed mappings
    const pendingCountResult = await channelDb
      .select({ count: sql<number>`count(*)` })
      .from(pimMedusaMappings)
      .where(eq(pimMedusaMappings.syncStatus, 'pending'));
    const pendingCount = pendingCountResult[0].count;

    const failedCountResult = await channelDb
      .select({ count: sql<number>`count(*)` })
      .from(pimMedusaMappings)
      .where(eq(pimMedusaMappings.syncStatus, 'failed'));
    const failedCount = failedCountResult[0].count;

    // Calculate difference
    const difference = pimCount - syncedCount;
    const syncRate = pimCount > 0 ? ((syncedCount / pimCount) * 100).toFixed(2) : '0.00';

    // Display results
    console.log(`${'='.repeat(60)}`);
    console.log('📦 Product Counts\n');
    console.log(`PIM Active Masters:        ${pimCount.toLocaleString()}`);
    console.log(`Channel Adapter Synced:    ${syncedCount.toLocaleString()}`);
    console.log(`Channel Adapter Pending:   ${pendingCount.toLocaleString()}`);
    console.log(`Channel Adapter Failed:    ${failedCount.toLocaleString()}`);
    console.log();
    console.log(`${'='.repeat(60)}`);
    console.log('📊 Sync Status\n');
    console.log(`Sync Rate:                 ${syncRate}%`);
    console.log(`Difference:                ${difference.toLocaleString()}`);
    console.log();

    // Determine overall status
    if (difference === 0 && failedCount === 0 && pendingCount === 0) {
      console.log(`${'='.repeat(60)}`);
      console.log('✅ VERIFICATION PASSED\n');
      console.log('All PIM active masters are synced to Medusa.');
      console.log('No pending or failed items.');
      console.log(`${'='.repeat(60)}\n`);
    } else if (difference > 0) {
      console.log(`${'='.repeat(60)}`);
      console.log('⚠️  VERIFICATION WARNING\n');
      console.log(`${difference} PIM masters are not synced yet.`);

      if (pendingCount > 0) {
        console.log(`${pendingCount} items are pending sync.`);
      }
      if (failedCount > 0) {
        console.log(`${failedCount} items failed to sync.`);
      }

      console.log();
      console.log('💡 Suggestions:');
      if (difference > syncedCount * 0.1) {
        console.log('   - Run a new migration to sync missing masters');
        console.log('   - Check if new products were added to PIM after migration');
      }
      if (failedCount > 0) {
        console.log('   - Review failed items and retry with:');
        console.log('     npx ts-node apps/channel-adapter/scripts/retry-failed.ts --all');
      }
      console.log(`${'='.repeat(60)}\n`);
    } else if (difference < 0) {
      console.log(`${'='.repeat(60)}`);
      console.log('❌ VERIFICATION FAILED\n');
      console.log(`Channel Adapter has MORE synced items than PIM active masters!`);
      console.log('This may indicate:');
      console.log('   - Stale data in Channel Adapter');
      console.log('   - Products deleted from PIM but not removed from Medusa');
      console.log('   - Data inconsistency requiring manual investigation');
      console.log(`${'='.repeat(60)}\n`);
    }

    // Detailed verification
    if (options.detailed && difference !== 0) {
      console.log('🔍 Detailed Analysis (Finding missing masters)...\n');

      // Get all PIM master IDs
      const pimMasterIds = await pimDb<Array<{ master_id: string }>>`
        SELECT pm.id AS master_id
        FROM product_masters pm
        INNER JOIN product_master_versions pmv ON pm.id = pmv.master_id
        WHERE pmv.status = 'active'
          AND pmv.deleted_at IS NULL
          AND pm.deleted_at IS NULL
        ORDER BY pm.created_at DESC
      `;

      // Get all synced master IDs from Channel Adapter
      const syncedMasterIds = await channelDb
        .select({ masterId: pimMedusaMappings.pimMasterId })
        .from(pimMedusaMappings)
        .where(eq(pimMedusaMappings.syncStatus, 'synced'));

      const syncedMasterIdSet = new Set(syncedMasterIds.map((m) => m.masterId));

      // Find missing masters
      const missingMasters = pimMasterIds.filter((m) => !syncedMasterIdSet.has(m.master_id)).slice(0, 50); // Limit to first 50

      if (missingMasters.length > 0) {
        console.log(`${'='.repeat(60)}`);
        console.log('❌ Missing Masters (first 50)\n');
        missingMasters.forEach((m, idx) => {
          console.log(`${idx + 1}. ${m.master_id}`);
        });

        if (difference > 50) {
          console.log(`\n... and ${difference - 50} more`);
        }
        console.log();
        console.log(`${'='.repeat(60)}\n`);
      }

      // Find extra masters (if difference < 0)
      if (difference < 0) {
        const pimMasterIdSet = new Set(pimMasterIds.map((m) => m.master_id));

        const extraMasters = syncedMasterIds.filter((m) => !pimMasterIdSet.has(m.masterId)).slice(0, 50);

        if (extraMasters.length > 0) {
          console.log(`${'='.repeat(60)}`);
          console.log('⚠️  Extra Synced Masters (first 50)\n');
          console.log('These are in Channel Adapter but not in PIM:\n');
          extraMasters.forEach((m, idx) => {
            console.log(`${idx + 1}. ${m.masterId}`);
          });

          if (Math.abs(difference) > 50) {
            console.log(`\n... and ${Math.abs(difference) - 50} more`);
          }
          console.log();
          console.log(`${'='.repeat(60)}\n`);
        }
      }
    }

    process.exit(difference === 0 && failedCount === 0 && pendingCount === 0 ? 0 : 1);
  } catch (error: any) {
    console.error('\n❌ Verification failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cleanup connections
    console.log('🧹 Cleaning up connections...');
    await pimDb.end();
    await channelDbClient.end();
  }
}

// Run main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
