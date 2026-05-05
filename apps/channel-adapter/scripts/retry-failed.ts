#!/usr/bin/env ts-node
// apps/channel-adapter/scripts/retry-failed.ts
/**
 * Retry Failed Migrations
 *
 * Retries all failed products from a migration session
 *
 * Usage:
 *   # Retry failures from specific session
 *   npx ts-node apps/channel-adapter/scripts/retry-failed.ts --session=backfill-1737600000-abc12345
 *
 *   # Retry all unresolved failures
 *   npx ts-node apps/channel-adapter/scripts/retry-failed.ts --all
 */

import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ConfigService } from '@nestjs/config';
import { channelAdapterSchema, migrationFailures } from '../src/schema';
import { MigrationSessionService } from './lib/migration-session.service';
import { syncWithRetry } from './lib/error-classifier';
import { PimMedusaSyncService } from '../src/adapters/medusa/pim-medusa-sync.service';
import { MedusaClient } from '../src/adapters/medusa/medusa.client';
import { PimMedusaMappingRepository } from '../src/adapters/medusa/pim-medusa-mapping.repository';
import type { PimProductSnapshot } from '../src/types';
import { eq, and } from 'drizzle-orm';

/**
 * Parse command-line arguments
 */
function parseArgs(): { sessionId?: string; all: boolean } {
  const args = process.argv.slice(2);

  // `--session=<id>` 와 `--session <id>` 둘 다 허용 (npm alias 호환)
  const eqArg = args.find((a) => a.startsWith('--session='));
  let sessionId: string | undefined = eqArg ? eqArg.slice('--session='.length) : undefined;
  if (!sessionId) {
    const idx = args.indexOf('--session');
    if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
      sessionId = args[idx + 1];
    }
  }
  const allFlag = args.includes('--all');

  return { sessionId, all: allFlag };
}

/**
 * Validate environment variables
 */
function validateEnv(): void {
  const required = ['DATABASE_URL', 'MEDUSA_API_URL', 'MEDUSA_API_KEY'];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    process.exit(1);
  }
}

/**
 * Main retry function
 */
async function main() {
  console.log('🔁 Retry Failed Migrations\n');

  // Parse arguments
  const options = parseArgs();

  if (!options.sessionId && !options.all) {
    console.error('❌ Please specify --session=SESSION_ID or --all');
    console.error('\nUsage:');
    console.error('  npx ts-node apps/channel-adapter/scripts/retry-failed.ts --session=SESSION_ID');
    console.error('  npx ts-node apps/channel-adapter/scripts/retry-failed.ts --all');
    process.exit(1);
  }

  // Validate environment
  validateEnv();

  // Initialize services
  console.log('🔌 Connecting to database...');
  const channelDbClient = postgres(process.env.DATABASE_URL!);
  const channelDb = drizzle(channelDbClient, { schema: channelAdapterSchema });

  const configService = new ConfigService({
    MEDUSA_API_URL: process.env.MEDUSA_API_URL,
    MEDUSA_API_KEY: process.env.MEDUSA_API_KEY,
    MEDUSA_MEMBERSHIP_GROUP_ID: process.env.MEDUSA_MEMBERSHIP_GROUP_ID,
  });

  const sessionService = new MigrationSessionService(channelDb);
  const medusaClient = new MedusaClient(configService);
  const mappingRepo = new PimMedusaMappingRepository({ db: channelDb } as any);
  const syncService = new PimMedusaSyncService(medusaClient, mappingRepo);

  try {
    // Query failures
    console.log('📋 Loading failed products...\n');
    let failures;

    if (options.sessionId) {
      failures = await channelDb
        .select()
        .from(migrationFailures)
        .where(and(eq(migrationFailures.sessionId, options.sessionId), eq(migrationFailures.resolved, false)));
    } else {
      failures = await channelDb.select().from(migrationFailures).where(eq(migrationFailures.resolved, false));
    }

    if (failures.length === 0) {
      console.log('✅ No failed products to retry!');
      process.exit(0);
    }

    console.log(`Found ${failures.length} failed products\n`);

    // Retry each failure
    let successCount = 0;
    let stillFailedCount = 0;

    for (let i = 0; i < failures.length; i++) {
      const failure = failures[i];
      const num = i + 1;

      console.log(`[${num}/${failures.length}] Retrying ${failure.masterId}...`);

      try {
        const snapshot = failure.snapshot as unknown as PimProductSnapshot;

        // Retry sync
        await syncWithRetry(snapshot, syncService, 3);

        // Mark as resolved
        await sessionService.resolveFailure(failure.id);

        successCount++;
        console.log(`  ✅ Success\n`);
      } catch (error: any) {
        stillFailedCount++;

        // Increment retry count
        await sessionService.incrementRetryCount(failure.id, error);

        console.error(`  ❌ Still failing: ${error.message}\n`);
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Print summary
    console.log(`${'='.repeat(60)}`);
    console.log('📊 Retry Summary\n');
    console.log(`Total attempted: ${failures.length}`);
    console.log(`✅ Resolved: ${successCount}`);
    console.log(`❌ Still failing: ${stillFailedCount}`);
    console.log(`${'='.repeat(60)}\n`);

    if (stillFailedCount > 0) {
      console.log('⚠️  Some products still failing. Check logs for details.');
    }

    await channelDbClient.end();
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Retry failed:', error.message);
    console.error(error.stack);
    await channelDbClient.end();
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
