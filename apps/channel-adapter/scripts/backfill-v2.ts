#!/usr/bin/env ts-node
// apps/channel-adapter/scripts/backfill-v2.ts
/**
 * PIM → Medusa Backfill Script v2
 *
 * Improved migration script with:
 * - Direct PIM database queries (batch JOINs instead of N+1 API calls)
 * - Checkpoint-based session management (resume after interruption)
 * - Comprehensive error handling and retry logic
 * - Progress tracking in database
 *
 * Usage:
 *   # New migration
 *   PIM_SOURCE_DB_URL=postgres://... DATABASE_URL=... MEDUSA_API_URL=... MEDUSA_API_KEY=... \
 *   npx ts-node apps/channel-adapter/scripts/backfill-v2.ts
 *
 *   # With options
 *   npx ts-node apps/channel-adapter/scripts/backfill-v2.ts --batch-size=50 --limit=100
 *
 *   # Resume from checkpoint
 *   npx ts-node apps/channel-adapter/scripts/backfill-v2.ts --resume=backfill-1737600000-abc12345
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ConfigService } from '@nestjs/config';
import { channelAdapterSchema } from '../src/schema';
import { PimSnapshotBuilder } from './lib/pim-snapshot-builder';
import { MigrationSessionService } from './lib/migration-session.service';
import { syncWithRetry, classifyError } from './lib/error-classifier';
import { PimMedusaSyncService } from '../src/adapters/medusa/pim-medusa-sync.service';
import { MedusaClient } from '../src/adapters/medusa/medusa.client';
import { PimMedusaMappingRepository } from '../src/adapters/medusa/pim-medusa-mapping.repository';

// Command-line options
interface BackfillOptions {
  batchSize: number;
  resumeSessionId?: string;
  limit?: number;
}

/**
 * Parse command-line arguments
 */
function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);

  const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
  const resumeArg = args.find(a => a.startsWith('--resume='));
  const limitArg = args.find(a => a.startsWith('--limit='));

  return {
    batchSize: batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 100,
    resumeSessionId: resumeArg ? resumeArg.split('=')[1] : undefined,
    limit: limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined,
  };
}

/**
 * Validate environment variables
 */
function validateEnv(): void {
  const required = [
    'PIM_SOURCE_DB_URL',
    'DATABASE_URL',
    'MEDUSA_API_URL',
    'MEDUSA_API_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    process.exit(1);
  }
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Main backfill function
 */
async function main() {
  console.log('🚀 PIM → Medusa Backfill Script v2\n');

  // Parse arguments
  const options = parseArgs();
  console.log('📋 Options:');
  console.log(`   Batch size: ${options.batchSize}`);
  if (options.resumeSessionId) {
    console.log(`   Resume session: ${options.resumeSessionId}`);
  }
  if (options.limit) {
    console.log(`   Limit: ${options.limit} products`);
  }
  console.log();

  // Validate environment
  validateEnv();

  // Initialize PIM database connection (READ-ONLY)
  console.log('🔌 Connecting to PIM database...');
  const pimDb = postgres(process.env.PIM_SOURCE_DB_URL!, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  // Initialize Channel Adapter database
  console.log('🔌 Connecting to Channel Adapter database...');
  const channelDbClient = postgres(process.env.DATABASE_URL!);
  const channelDb = drizzle(channelDbClient, { schema: channelAdapterSchema });

  // Initialize ConfigService for Medusa client
  const configService = new ConfigService({
    MEDUSA_API_URL: process.env.MEDUSA_API_URL,
    MEDUSA_API_KEY: process.env.MEDUSA_API_KEY,
    MEDUSA_MEMBERSHIP_GROUP_ID: process.env.MEDUSA_MEMBERSHIP_GROUP_ID,
  });

  // Initialize services
  const snapshotBuilder = new PimSnapshotBuilder(pimDb);
  const sessionService = new MigrationSessionService(channelDb);
  const medusaClient = new MedusaClient(configService);
  const mappingRepo = new PimMedusaMappingRepository({ db: channelDb } as any);
  const syncService = new PimMedusaSyncService(medusaClient, mappingRepo);

  let startTime = Date.now();

  try {
    // Create or resume session
    let session;
    if (options.resumeSessionId) {
      session = await sessionService.loadSession(options.resumeSessionId);
      if (!session) {
        console.error(`❌ Session not found: ${options.resumeSessionId}`);
        process.exit(1);
      }
      console.log(`📦 Resuming session: ${session.sessionId}`);
      console.log(`   Already processed: ${session.processedCount}`);
      console.log(`   Current offset: ${session.currentOffset}\n`);
    } else {
      session = await sessionService.createSession(options.batchSize);
      console.log(`🆕 New session created: ${session.sessionId}\n`);
    }

    let offset = session.currentOffset;
    let totalProcessed = 0;
    let batchNumber = Math.floor(offset / session.batchSize) + 1;

    // Main processing loop
    while (true) {
      console.log(`\n📊 Batch ${batchNumber}: Fetching ${session.batchSize} products from offset ${offset}...`);

      // Fetch batch
      const snapshots = await snapshotBuilder.fetchActiveMasters(
        session.batchSize,
        offset
      );

      if (snapshots.length === 0) {
        console.log('✅ No more products to process');
        break;
      }

      console.log(`   Processing ${snapshots.length} products...\n`);

      // Process batch
      let batchSuccess = 0;
      let batchFailed = 0;

      for (let i = 0; i < snapshots.length; i++) {
        const snapshot = snapshots[i];
        const num = offset + i + 1;

        try {
          // Sync with retry
          const result = await syncWithRetry(snapshot, syncService, 3);

          batchSuccess++;
          console.log(`  ✅ [${num}] ${snapshot.name} (${snapshot.masterId})`);

        } catch (error: any) {
          batchFailed++;
          const errorType = classifyError(error);

          // Record failure
          await sessionService.recordFailure(
            session.sessionId,
            snapshot.masterId,
            snapshot.versionId,
            error,
            errorType,
            snapshot
          );

          console.error(`  ❌ [${num}] ${snapshot.name} (${snapshot.masterId})`);
          console.error(`     ${errorType}: ${error.message}`);
        }
      }

      // Update progress
      const newProcessedCount = session.processedCount + snapshots.length;
      const newSuccessCount = session.successCount + batchSuccess;
      const newFailedCount = session.failedCount + batchFailed;

      await sessionService.updateProgress(session.sessionId, {
        processedCount: newProcessedCount,
        successCount: newSuccessCount,
        failedCount: newFailedCount,
        skippedCount: session.skippedCount,
        currentOffset: offset + session.batchSize,
        lastProcessedMasterId: snapshots[snapshots.length - 1].masterId,
      });

      // Update local session object
      session.processedCount = newProcessedCount;
      session.successCount = newSuccessCount;
      session.failedCount = newFailedCount;

      // Print batch summary
      console.log(`\n   Batch ${batchNumber} complete:`);
      console.log(`     Success: ${batchSuccess}`);
      console.log(`     Failed: ${batchFailed}`);
      console.log(`     Total processed: ${newProcessedCount}`);

      totalProcessed += snapshots.length;

      // Check limit
      if (options.limit && totalProcessed >= options.limit) {
        console.log(`\n⏸️  Limit reached: ${options.limit} products`);
        break;
      }

      // Move to next batch
      offset += session.batchSize;
      batchNumber++;

      // Rate limiting (1 second between batches)
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Complete session
    await sessionService.completeSession(session.sessionId);

    // Print final summary
    const duration = Date.now() - startTime;
    const successRate = session.processedCount > 0
      ? (session.successCount / session.processedCount * 100).toFixed(1)
      : '0.0';

    console.log(`\n${'='.repeat(60)}`);
    console.log('🎉 Migration completed successfully!\n');
    console.log(`Session: ${session.sessionId}`);
    console.log(`Duration: ${formatDuration(duration)}\n`);
    console.log(`Results:`);
    console.log(`  Total processed: ${session.processedCount}`);
    console.log(`  ✅ Success: ${session.successCount} (${successRate}%)`);
    console.log(`  ❌ Failed: ${session.failedCount}`);
    console.log(`  ⏭️  Skipped: ${session.skippedCount}`);
    console.log(`${'='.repeat(60)}\n`);

    if (session.failedCount > 0) {
      console.log(`⚠️  Some products failed. You can retry them with:`);
      console.log(`   npx ts-node apps/channel-adapter/scripts/retry-failed.ts --session=${session.sessionId}\n`);
    }

    process.exit(0);

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);

    // Try to mark session as failed
    try {
      if (options.resumeSessionId) {
        await sessionService.failSession(options.resumeSessionId, error);
      }
    } catch (failError) {
      console.error('Failed to update session status:', failError);
    }

    process.exit(1);

  } finally {
    // Cleanup connections
    console.log('\n🧹 Cleaning up connections...');
    await snapshotBuilder.close();
    await channelDbClient.end();
  }
}

// Run main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
