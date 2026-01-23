#!/usr/bin/env ts-node
// apps/channel-adapter/scripts/check-progress.ts
/**
 * Check Migration Progress
 *
 * Displays detailed progress information for a migration session
 *
 * Usage:
 *   # Check specific session
 *   npx ts-node apps/channel-adapter/scripts/check-progress.ts --session=backfill-1737600000-abc12345
 *
 *   # Check latest session
 *   npx ts-node apps/channel-adapter/scripts/check-progress.ts --latest
 */

import { DbService } from '@app/db';
import { channelAdapterSchema, migrationProgress, migrationFailures } from '../src/schema';
import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * Parse command-line arguments
 */
function parseArgs(): { sessionId?: string; latest: boolean } {
  const args = process.argv.slice(2);

  const sessionArg = args.find(a => a.startsWith('--session='));
  const latestFlag = args.includes('--latest');

  return {
    sessionId: sessionArg ? sessionArg.split('=')[1] : undefined,
    latest: latestFlag,
  };
}

/**
 * Validate environment variables
 */
function validateEnv(): void {
  const required = ['DATABASE_URL'];

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
 * Format timestamp
 */
function formatTimestamp(date: Date | null): string {
  if (!date) return 'N/A';
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Main check progress function
 */
async function main() {
  console.log('📊 Migration Progress Check\n');

  // Parse arguments
  const options = parseArgs();

  if (!options.sessionId && !options.latest) {
    console.error('❌ Please specify --session=SESSION_ID or --latest');
    console.error('\nUsage:');
    console.error('  npx ts-node apps/channel-adapter/scripts/check-progress.ts --session=SESSION_ID');
    console.error('  npx ts-node apps/channel-adapter/scripts/check-progress.ts --latest');
    process.exit(1);
  }

  // Validate environment
  validateEnv();

  // Initialize database
  console.log('🔌 Connecting to database...\n');
  const channelDb = new DbService({
    connectionString: process.env.DATABASE_URL!,
    schema: channelAdapterSchema,
  });

  try {
    // Query session
    let session;

    if (options.latest) {
      console.log('🔍 Finding latest session...\n');
      const sessions = await channelDb.db
        .select()
        .from(migrationProgress)
        .orderBy(desc(migrationProgress.startedAt))
        .limit(1);

      session = sessions[0];
    } else {
      const sessions = await channelDb.db
        .select()
        .from(migrationProgress)
        .where(eq(migrationProgress.sessionId, options.sessionId!));

      session = sessions[0];
    }

    if (!session) {
      console.error(`❌ Session not found: ${options.sessionId || 'latest'}`);
      process.exit(1);
    }

    // Query failure stats
    const failureStats = await channelDb.db
      .select({
        total: sql<number>`count(*)`,
        unresolved: sql<number>`count(*) filter (where ${migrationFailures.resolved} = false)`,
        resolved: sql<number>`count(*) filter (where ${migrationFailures.resolved} = true)`,
      })
      .from(migrationFailures)
      .where(eq(migrationFailures.sessionId, session.sessionId));

    const failures = failureStats[0] || { total: 0, unresolved: 0, resolved: 0 };

    // Calculate statistics
    const successRate = session.processedCount > 0
      ? (session.successCount / session.processedCount * 100).toFixed(1)
      : '0.0';

    const failureRate = session.processedCount > 0
      ? (session.failedCount / session.processedCount * 100).toFixed(1)
      : '0.0';

    const duration = session.completedAt
      ? session.completedAt.getTime() - session.startedAt.getTime()
      : Date.now() - session.startedAt.getTime();

    const avgTimePerProduct = session.processedCount > 0
      ? Math.round(duration / session.processedCount)
      : 0;

    // Display session info
    console.log(`${'='.repeat(60)}`);
    console.log('📦 Session Information\n');
    console.log(`Session ID:     ${session.sessionId}`);
    console.log(`Status:         ${getStatusEmoji(session.status)} ${session.status.toUpperCase()}`);
    console.log(`Started At:     ${formatTimestamp(session.startedAt)}`);
    console.log(`Completed At:   ${formatTimestamp(session.completedAt)}`);
    console.log(`Duration:       ${formatDuration(duration)}`);
    console.log();

    // Display progress
    console.log(`${'='.repeat(60)}`);
    console.log('📈 Progress\n');
    console.log(`Total Masters:  ${session.totalMasters.toLocaleString()}`);
    console.log(`Processed:      ${session.processedCount.toLocaleString()}`);
    console.log(`✅ Success:     ${session.successCount.toLocaleString()} (${successRate}%)`);
    console.log(`❌ Failed:      ${session.failedCount.toLocaleString()} (${failureRate}%)`);
    console.log(`⏭️  Skipped:     ${session.skippedCount.toLocaleString()}`);
    console.log();

    // Display batch info
    console.log(`${'='.repeat(60)}`);
    console.log('⚙️  Batch Configuration\n');
    console.log(`Batch Size:     ${session.batchSize}`);
    console.log(`Current Offset: ${session.currentOffset.toLocaleString()}`);
    console.log(`Current Batch:  ${Math.floor(session.currentOffset / session.batchSize) + 1}`);
    console.log();

    // Display performance metrics
    if (session.processedCount > 0) {
      console.log(`${'='.repeat(60)}`);
      console.log('⚡ Performance\n');
      console.log(`Avg Time/Product: ${avgTimePerProduct}ms`);
      console.log(`Throughput:       ${(1000 / avgTimePerProduct * 60).toFixed(1)} products/min`);
      console.log();
    }

    // Display failure details
    if (session.failedCount > 0) {
      console.log(`${'='.repeat(60)}`);
      console.log('🔍 Failure Details\n');
      console.log(`Total Failures:      ${failures.total}`);
      console.log(`❌ Unresolved:       ${failures.unresolved}`);
      console.log(`✅ Resolved:         ${failures.resolved}`);
      console.log();

      if (failures.unresolved > 0) {
        console.log(`⚠️  You can retry unresolved failures with:`);
        console.log(`   npx ts-node apps/channel-adapter/scripts/retry-failed.ts --session=${session.sessionId}\n`);
      }
    }

    // Display last processed item
    if (session.lastProcessedMasterId) {
      console.log(`${'='.repeat(60)}`);
      console.log('📍 Last Processed\n');
      console.log(`Master ID: ${session.lastProcessedMasterId}`);
      console.log();
    }

    // Display error if failed
    if (session.status === 'failed' && session.lastError) {
      console.log(`${'='.repeat(60)}`);
      console.log('❌ Error Information\n');
      console.log(`Error: ${session.lastError}`);
      if (session.errorStackTrace) {
        console.log(`\nStack Trace:\n${session.errorStackTrace}`);
      }
      console.log();
    }

    // Display resume command if in progress
    if (session.status === 'in_progress') {
      console.log(`${'='.repeat(60)}`);
      console.log('💡 Resume Command\n');
      console.log(`npx ts-node apps/channel-adapter/scripts/backfill-v2.ts --resume=${session.sessionId}`);
      console.log();
    }

    console.log(`${'='.repeat(60)}\n`);

    process.exit(0);

  } catch (error: any) {
    console.error('\n❌ Check progress failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Get emoji for status
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    case 'in_progress':
      return '🔄';
    case 'paused':
      return '⏸️';
    default:
      return '❓';
  }
}

// Run main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
