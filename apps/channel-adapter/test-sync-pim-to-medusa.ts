/**
 * PIM-Medusa 백필 스크립트
 * 
 * 사용법:
 * - 전체 동기화: npx tsx sync-pim-to-medusa.ts --all
 * - 단건 동기화: npx tsx sync-pim-to-medusa.ts --master <masterId>
 * - 여러 건 동기화: npx tsx sync-pim-to-medusa.ts --masters <id1>,<id2>,<id3>
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AdapterModule } from './src/adapter.module';
import { PimMedusaSyncService } from './src/services/pim-medusa-sync/pim-medusa-sync.service';

const logger = new Logger('SyncPimToMedusa');

async function main() {
    const args = process.argv.slice(2);

    // 인자 파싱
    const allFlag = args.includes('--all');
    const masterIndex = args.indexOf('--master');
    const mastersIndex = args.indexOf('--masters');

    if (!allFlag && masterIndex === -1 && mastersIndex === -1) {
        logger.error('Usage:');
        logger.error('  --all                    # Sync all active PIM masters');
        logger.error('  --master <masterId>      # Sync single master');
        logger.error('  --masters <id1>,<id2>... # Sync multiple masters');
        process.exit(1);
    }

    // NestJS 앱 부트스트랩
    logger.log('Initializing application...');
    const app = await NestFactory.createApplicationContext(AdapterModule, {
        logger: ['log', 'error', 'warn'],
    });

    const syncService = app.get(PimMedusaSyncService);

    try {
        // 헬스 체크
        logger.log('Checking connections...');
        const health = await syncService.healthCheck();
        if (!health.overall) {
            logger.error('Health check failed:', health);
            throw new Error('PIM or Medusa connection failed');
        }
        logger.log('✅ Connections OK');

        // 동기화 실행
        if (allFlag) {
            // 전체 동기화
            logger.log('🔄 Starting full sync...');
            const results = await syncService.syncAllActiveMasters();

            const successCount = results.filter((r) => r.success).length;
            const failCount = results.length - successCount;

            logger.log('==== SYNC RESULTS ====');
            logger.log(`Total: ${results.length}`);
            logger.log(`✅ Success: ${successCount}`);
            logger.log(`❌ Failed: ${failCount}`);

            if (failCount > 0) {
                logger.warn('Failed masters:');
                results
                    .filter((r) => !r.success)
                    .forEach((r) => {
                        logger.warn(`  - ${r.masterId}: ${r.error}`);
                    });
            }

        } else if (masterIndex !== -1) {
            // 단건 동기화
            const masterId = args[masterIndex + 1];
            if (!masterId) {
                throw new Error('--master requires a masterId argument');
            }

            logger.log(`🔄 Syncing single master: ${masterId}`);
            const result = await syncService.syncMaster(masterId);

            if (result.success) {
                logger.log(`✅ Success: ${masterId} → Medusa ${result.medusaProductId} (${result.action})`);
            } else {
                logger.error(`❌ Failed: ${masterId} - ${result.error}`);
                process.exit(1);
            }

        } else if (mastersIndex !== -1) {
            // 여러 건 동기화
            const mastersStr = args[mastersIndex + 1];
            if (!mastersStr) {
                throw new Error('--masters requires comma-separated masterIds');
            }

            const masterIds = mastersStr.split(',').map((id) => id.trim());
            logger.log(`🔄 Syncing ${masterIds.length} masters...`);

            const results = await syncService.syncMultipleMasters(masterIds);

            const successCount = results.filter((r) => r.success).length;
            const failCount = results.length - successCount;

            logger.log('==== SYNC RESULTS ====');
            logger.log(`Total: ${results.length}`);
            logger.log(`✅ Success: ${successCount}`);
            logger.log(`❌ Failed: ${failCount}`);

            results.forEach((r) => {
                if (r.success) {
                    logger.log(`✅ ${r.masterId} → ${r.medusaProductId} (${r.action})`);
                } else {
                    logger.error(`❌ ${r.masterId}: ${r.error}`);
                }
            });

            if (failCount > 0) {
                process.exit(1);
            }
        }

        logger.log('🎉 Sync completed successfully');

    } catch (error) {
        logger.error('❌ Sync failed:', error.stack);
        process.exit(1);
    } finally {
        await app.close();
    }
}

main();

