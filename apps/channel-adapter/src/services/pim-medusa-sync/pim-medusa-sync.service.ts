import { Injectable, Logger } from '@nestjs/common';
import { PimClient } from './pim.client';
import { MedusaClient } from './medusa.client';
import {
    transformPimToMedusa,
    validatePimSnapshot,
} from './pim-to-medusa.transformer';
import type { PimActiveVersionChangedEvent } from '../../types';

export interface SyncResult {
    success: boolean;
    masterId: string;
    medusaProductId?: string;
    action?: 'created' | 'updated' | 'skipped';
    error?: string;
}

@Injectable()
export class PimMedusaSyncService {
    private readonly logger = new Logger(PimMedusaSyncService.name);

    constructor(
        private readonly pimClient: PimClient,
        private readonly medusaClient: MedusaClient,
    ) { }

    // 단일 Master 동기화 (Main Entry Point)
    async syncMaster(masterId: string): Promise<SyncResult> {
        this.logger.log(`Starting sync for PIM master: ${masterId}`);

        try {
            // 1. PIM Active Version 조회
            const snapshot = await this.pimClient.getActiveVersion(masterId);

            // 2. 검증
            validatePimSnapshot(snapshot);

            // 3. Medusa Payload로 변환
            const medusaPayload = transformPimToMedusa(snapshot);

            // 4. Medusa에 Upsert
            const { product, action } = await this.medusaClient.upsertProduct(
                medusaPayload,
            );

            this.logger.log(
                `Sync completed: ${masterId} → Medusa ${product.id} (${action})`,
            );

            return {
                success: true,
                masterId,
                medusaProductId: product.id,
                action,
            };
        } catch (error) {
            this.logger.error(
                `Sync failed for master ${masterId}`,
                error.stack,
            );

            return {
                success: false,
                masterId,
                error: error.message,
            };
        }
    }

    // 여러 Masters 일괄 동기화 (백필용)
    async syncMultipleMasters(masterIds: string[]): Promise<SyncResult[]> {
        this.logger.log(`Syncing ${masterIds.length} PIM masters...`);

        const results: SyncResult[] = [];

        for (const masterId of masterIds) {
            const result = await this.syncMaster(masterId);
            results.push(result);

            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.length - successCount;

        this.logger.log(
            `Batch sync completed: ${successCount} success, ${failCount} failed`,
        );

        return results;
    }

    // 전체 Active Masters 동기화 (Full Backfill)
    async syncAllActiveMasters(): Promise<SyncResult[]> {
        this.logger.log('🔄 Starting full sync of all active PIM masters...');

        try {
            // 1. 모든 Active Master 목록 조회
            const masterIds = await this.pimClient.getAllActiveMasters();

            this.logger.log(`Found ${masterIds.length} active masters to sync`);

            // 2. 일괄 동기화
            const results = await this.syncMultipleMasters(masterIds);

            return results;
        } catch (error) {
            this.logger.error('Full sync failed', error.stack);
            throw error;
        }
    }

    // 이벤트 기반 동기화 (Kafka 컨슈머용)
    async handleActiveVersionChanged(
        event: PimActiveVersionChangedEvent,
    ): Promise<void> {
        const { masterId, productId, changeReason } = event;

        this.logger.log(
            `📨 PIM Event: ${masterId} (${changeReason}) - productId: ${productId}`,
        );

        // changeReason에 따라 처리
        switch (changeReason) {
            case 'published':
            case 'rollback':
                // Active 버전 생성/변경 → Medusa에 동기화 (published)
                if (!productId) {
                    this.logger.error(`productId is null for published/rollback event`);
                    return;
                }
                await this.syncMaster(masterId);
                break;

            case 'unpublished':
                // PIM의 active가 없다 = 쇼핑몰에서 보여줄 필요 없음
                this.logger.log(
                    `Master ${masterId} unpublished → Deleting from Medusa`,
                );
                await this.medusaClient.deleteProduct(masterId);
                break;

            default:
                this.logger.warn(`Unknown changeReason: ${changeReason}`);
        }
    }

    // 헬스 체크: PIM & Medusa 연결 확인
    async healthCheck(): Promise<{
        pim: boolean;
        medusa: boolean;
        overall: boolean;
    }> {
        const pim = await this.pimClient.healthCheck();
        const medusa = await this.medusaClient.healthCheck();
        const overall = pim && medusa;

        this.logger.log(`Health check - PIM: ${pim}, Medusa: ${medusa}`);

        return { pim, medusa, overall };
    }
}

