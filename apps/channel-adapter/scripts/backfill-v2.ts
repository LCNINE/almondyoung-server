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
 *   CORE_DB_URL=postgres://... DATABASE_URL=... MEDUSA_API_URL=... MEDUSA_API_KEY=... \
 *   npx ts-node apps/channel-adapter/scripts/backfill-v2.ts
 *
 *   # With options
 *   npx ts-node apps/channel-adapter/scripts/backfill-v2.ts --batch-size=50 --limit=100 --concurrency=5
 *
 *   # 특정 master 만 재동기화 (부분 타겟팅, 예: 디지털 상품)
 *   npx ts-node apps/channel-adapter/scripts/backfill-v2.ts --master-ids=uuid1,uuid2,uuid3
 *
 *   # Resume from checkpoint
 *   npx ts-node apps/channel-adapter/scripts/backfill-v2.ts --resume=backfill-1737600000-abc12345
 */

import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ConfigService } from '@nestjs/config';
import { channelAdapterSchema } from '../src/schema';
import { PimSnapshotBuilder } from './lib/pim-snapshot-builder';
import { MigrationSessionService } from './lib/migration-session.service';
import { syncWithRetry, classifyError } from './lib/error-classifier';
import { PimMedusaSyncService } from '../src/adapters/medusa/pim-medusa-sync.service';
import { StorefrontRevalidateService } from '../src/adapters/medusa/storefront-revalidate.service';
import { MedusaClient } from '../src/adapters/medusa/medusa.client';
import { PimMedusaMappingRepository } from '../src/adapters/medusa/pim-medusa-mapping.repository';

// Command-line options
interface BackfillOptions {
  batchSize: number;
  resumeSessionId?: string;
  limit?: number;
  concurrency: number;
  rateLimitMs: number;
  masterIds?: string[];
}

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 10;
const DEFAULT_RATE_LIMIT_MS = 1000;

/**
 * Parse command-line arguments.
 * `--key=value` / `--key value` 두 형식 모두 받는다 (npm alias 호환).
 */
function getArgValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const eqArg = args.find((a) => a.startsWith(prefix));
  if (eqArg) return eqArg.slice(prefix.length);
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) {
    const next = args[idx + 1];
    // 다음 토큰이 또 다른 `--flag` 면 값으로 취급하지 않음.
    if (!next.startsWith('--')) return next;
  }
  return undefined;
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);

  const batchSizeRaw = getArgValue(args, 'batch-size');
  const resumeRaw = getArgValue(args, 'resume');
  const limitRaw = getArgValue(args, 'limit');
  const concurrencyRaw = getArgValue(args, 'concurrency');
  const rateLimitRaw = getArgValue(args, 'rate-limit-ms');

  // primeAll 적용 후 상품당 HTTP 호출이 크게 줄어 기본 동시성 1 → 3 으로 상향.
  // Medusa Admin/RDS 부담을 감안해 상한은 10. 표본 스모크에서 5xx 비율을 본 뒤 결정 권장.
  const rawConcurrency = concurrencyRaw ? parseInt(concurrencyRaw, 10) : DEFAULT_CONCURRENCY;
  const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number.isFinite(rawConcurrency) ? rawConcurrency : DEFAULT_CONCURRENCY));

  const rawRateLimit = rateLimitRaw ? parseInt(rateLimitRaw, 10) : DEFAULT_RATE_LIMIT_MS;
  const rateLimitMs = Math.max(0, Number.isFinite(rawRateLimit) ? rawRateLimit : DEFAULT_RATE_LIMIT_MS);

  // --master-ids=uuid1,uuid2 : 지정한 master 만 재동기화(부분 타겟팅). 미지정 시 전체.
  const masterIdsRaw = getArgValue(args, 'master-ids');
  const masterIds = masterIdsRaw
    ? masterIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  return {
    batchSize: batchSizeRaw ? parseInt(batchSizeRaw, 10) : 100,
    resumeSessionId: resumeRaw,
    limit: limitRaw ? parseInt(limitRaw, 10) : undefined,
    concurrency,
    rateLimitMs,
    masterIds: masterIds?.length ? masterIds : undefined,
  };
}

/**
 * Validate environment variables
 */
function validateEnv(): void {
  const required = ['CORE_DB_URL', 'DATABASE_URL', 'MEDUSA_API_URL', 'MEDUSA_API_KEY'];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
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
  console.log(`   Concurrency: ${options.concurrency} (max ${MAX_CONCURRENCY})`);
  console.log(`   Rate limit between batches: ${options.rateLimitMs}ms`);
  if (options.resumeSessionId) {
    console.log(`   Resume session: ${options.resumeSessionId}`);
  }
  if (options.limit) {
    console.log(`   Limit: ${options.limit} products`);
  }
  console.log();

  // Validate environment
  validateEnv();

  // Initialize Core (구 PIM) database connection (READ-ONLY).
  // SST tunnel 의 SSM 포워딩이 동시 신규 TCP handshake 에 약하므로 풀을 직렬화한다.
  // 운영 컨테이너에서 바로 돌리는 경우엔 max 를 더 키워도 되지만, 로컬 tunnel 경로가
  // 표준이므로 보수적으로 잡는다.
  console.log('🔌 Connecting to Core database...');
  const pimDb = postgres(process.env.CORE_DB_URL!, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 60,
  });

  // Initialize Channel Adapter database (write 측도 동일 사유로 풀 보수화)
  console.log('🔌 Connecting to Channel Adapter database...');
  const channelDbClient = postgres(process.env.DATABASE_URL!, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 60,
  });
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
  // StorefrontRevalidateService 는 무인자 생성(환경변수 없으면 no-op). 생성자 3번째 인자 누락으로
  // backfill-v2 가 깨져 있던 것을 함께 보정한다.
  const syncService = new PimMedusaSyncService(
    medusaClient,
    mappingRepo,
    new StorefrontRevalidateService(),
  );

  // 카테고리/태그/타입/세일즈채널 캐시를 미리 채워 product 당 list/verify HTTP 호출을
  // 0 회에 가깝게 줄인다. 이후 cacheOnly 모드를 활성화해 paginated LIST 조회도 회피.
  console.log('🔥 Priming Medusa caches...');
  const primed = await medusaClient.primeAll();
  console.log(
    `   Cached ${primed.categories} categories, ${primed.tags} tags, ${primed.types} types, ${primed.channels} sales channels\n`,
  );
  medusaClient.enableCacheOnlyCategoryLookup(true);

  const startTime = Date.now();
  let stopRequested = false;
  const requestStop = () => {
    if (!stopRequested) {
      console.log('\n🛑 Stop requested. Finishing current item and saving checkpoint...');
      stopRequested = true;
    }
  };
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);

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

      // Fetch batch (masterIds 지정 시 해당 master 만 대상)
      const snapshots = await snapshotBuilder.fetchActiveMasters(session.batchSize, offset, options.masterIds);

      if (snapshots.length === 0) {
        console.log('✅ No more products to process');
        break;
      }

      console.log(`   Processing ${snapshots.length} products...\n`);

      // Process batch — concurrency 단위로 묶어 병렬 실행. 같은 청크 내 sync 결과는 순서대로
      // 적용해 checkpoint(processedCount/currentOffset 등) 가 monotonic 하게 증가하도록 한다.
      let batchSuccess = 0;
      let batchFailed = 0;
      let batchSkipped = 0;
      let shouldExit = false;
      const concurrency = options.concurrency;

      for (let i = 0; i < snapshots.length; i += concurrency) {
        const slice = snapshots.slice(i, i + concurrency);
        const results = await Promise.allSettled(
          slice.map((snapshot) => syncWithRetry(snapshot, syncService, 3)),
        );

        for (let k = 0; k < slice.length; k++) {
          const snapshot = slice[k];
          const num = offset + i + k + 1;
          const result = results[k];
          type Outcome = 'success' | 'skipped' | 'failed';
          let outcome: Outcome = 'failed';

          if (result.status === 'fulfilled') {
            const action = (result.value as { action?: string } | undefined)?.action;
            if (action === 'skipped') {
              outcome = 'skipped';
              batchSkipped += 1;
              console.log(`  ⏭️  [${num}] ${snapshot.name} (${snapshot.masterId}) — skipped`);
            } else {
              outcome = 'success';
              batchSuccess += 1;
              console.log(`  ✅ [${num}] ${snapshot.name} (${snapshot.masterId})`);
            }
          } else {
            const error = result.reason;
            batchFailed += 1;
            const errorType = classifyError(error);

            await sessionService.recordFailure(
              session.sessionId,
              snapshot.masterId,
              snapshot.versionId,
              error,
              errorType,
              snapshot,
            );

            console.error(`  ❌ [${num}] ${snapshot.name} (${snapshot.masterId})`);
            console.error(`     ${errorType}: ${error?.message || error}`);
          }

          session.processedCount += 1;
          if (outcome === 'success') {
            session.successCount += 1;
          } else if (outcome === 'skipped') {
            session.skippedCount += 1;
          } else {
            session.failedCount += 1;
          }
          session.currentOffset = offset + i + k + 1;
          session.lastProcessedMasterId = snapshot.masterId;
          try {
            await sessionService.updateProgress(session.sessionId, {
              processedCount: session.processedCount,
              successCount: session.successCount,
              failedCount: session.failedCount,
              skippedCount: session.skippedCount,
              currentOffset: session.currentOffset,
              lastProcessedMasterId: session.lastProcessedMasterId,
            });
          } catch (updateError: any) {
            console.error(
              `⚠️  Failed to persist checkpoint for ${snapshot.masterId}: ${updateError?.message || updateError}`,
            );
          }

          totalProcessed += 1;

          if (options.limit && totalProcessed >= options.limit) {
            console.log(`\n⏸️  Limit reached: ${options.limit} products`);
            shouldExit = true;
            break;
          }
          if (stopRequested) {
            shouldExit = true;
            break;
          }
        }
        if (shouldExit) break;
      }

      // Print batch summary
      console.log(`\n   Batch ${batchNumber} complete:`);
      console.log(`     Success: ${batchSuccess}`);
      console.log(`     Skipped: ${batchSkipped}`);
      console.log(`     Failed: ${batchFailed}`);
      console.log(`     Total processed: ${session.processedCount}`);

      if (shouldExit) {
        break;
      }

      // Move to next batch
      offset += session.batchSize;
      batchNumber++;

      // Rate limiting between batches (default 1s, configurable via --rate-limit-ms)
      if (options.rateLimitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.rateLimitMs));
      }
    }

    // Complete session
    await sessionService.completeSession(session.sessionId);

    // Print final summary
    const duration = Date.now() - startTime;
    const successRate =
      session.processedCount > 0 ? ((session.successCount / session.processedCount) * 100).toFixed(1) : '0.0';

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
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
