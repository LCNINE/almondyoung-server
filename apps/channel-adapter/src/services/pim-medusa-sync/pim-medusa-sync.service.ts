import { Injectable, Logger } from '@nestjs/common';
import { PimClient } from './pim.client';
import { MedusaClient } from './medusa.client';
import { PimMedusaMappingRepository } from './pim-medusa-mapping.repository';
import {
    transformPimToMedusa,
    validatePimSnapshot,
} from './pim-to-medusa.transformer';
import type { PimActiveVersionChangedEvent } from '../../types';

export interface SyncResult {
    success: boolean;
    masterId: string;
    medusaProductId?: string;
    action?: 'created' | 'updated' | 'skipped' | 'unpublished';
    error?: string;
}

@Injectable()
export class PimMedusaSyncService {
    private readonly logger = new Logger(PimMedusaSyncService.name);

    constructor(
        private readonly pimClient: PimClient,
        private readonly medusaClient: MedusaClient,
        private readonly mappingRepo: PimMedusaMappingRepository,
    ) { }

    // 단일 Master 동기화 (Main Entry Point - mapping 기반)
    async syncMaster(masterId: string, versionToCheck?: number): Promise<SyncResult> {
        this.logger.log(`Starting sync for PIM master: ${masterId}`);

        try {
            // 1. PIM Active Version 조회
            const snapshot = await this.pimClient.getActiveVersion(masterId);

            if (!snapshot || !snapshot.versionId) {
                this.logger.warn(`No active version for master ${masterId}`);
                return {
                    success: true,
                    masterId,
                    action: 'skipped',
                };
            }

            // shouldProcess 체크
            if (versionToCheck !== undefined) {
                const shouldProcess = await this.mappingRepo.shouldProcess(
                    masterId,
                    versionToCheck,
                );
                if (!shouldProcess) {
                    return {
                        success: true,
                        masterId,
                        action: 'skipped',
                    };
                }
            }

            // 3. 검증
            validatePimSnapshot(snapshot);

            // 4. Medusa Payload로 변환
            const medusaPayload = transformPimToMedusa(snapshot);

            // 5. 기존 매핑 조회
            const existingMapping = await this.mappingRepo.findByPimMasterId(masterId);
            const medusaProductId = existingMapping?.medusaProductId ?? undefined;

            // 6. Medusa에 Upsert
            const { product, action } = await this.medusaClient.upsertProduct(
                medusaPayload,
                medusaProductId,
            );

            this.logger.log(
                `Sync completed: ${masterId} → Medusa ${product.id} (${action})`,
            );

            // 7. 매핑 테이블 업데이트
            await this.mappingRepo.recordSuccess(masterId, {
                pimVersionId: snapshot.versionId,
                pimVersion: snapshot.version,
                medusaProductId: product.id,
                medusaHandle: medusaPayload.handle,
                action,
            });

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

            // 실패 기록
            try {
                const snapshot = await this.pimClient.getActiveVersion(masterId);
                if (snapshot && snapshot.versionId) {
                    await this.mappingRepo.recordFailure(masterId, {
                        pimVersionId: snapshot.versionId,
                        pimVersion: snapshot.version,
                        error: error.message,
                    });
                }
            } catch (recordError) {
                this.logger.error('Failed to record failure', recordError);
            }

            return {
                success: false,
                masterId,
                error: error.message,
            };
        }
    }

    // 여러 Masters 일괄 동기화
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

    // 전체 Active Masters 동기화
    async syncAllActiveMasters(): Promise<SyncResult[]> {
        this.logger.log('🔄 Starting full sync of all active PIM masters...');

        try {
            const masterIds = await this.pimClient.getAllActiveMasters();

            this.logger.log(`Found ${masterIds.length} active masters to sync`);

            const results = await this.syncMultipleMasters(masterIds);

            return results;
        } catch (error) {
            this.logger.error('Full sync failed', error.stack);
            throw error;
        }
    }

    // 이벤트 기반 동기화(Kafka 컨슈머용 - unpublished는 draft로)
    async handleActiveVersionChanged(
        event: PimActiveVersionChangedEvent,
    ): Promise<void> {
        const { masterId, productId, version, changeReason } = event;

        this.logger.log(
            `📨 PIM Event: ${masterId} (${changeReason}) - productId: ${productId}, version: ${version}`,
        );

        // changeReason에 따라 처리
        switch (changeReason) {
            case 'published':
            case 'rollback':
                if (!productId || version === null) {
                    this.logger.error(`productId or version is null for published/rollback event`);
                    return;
                }
                await this.syncMaster(masterId, version);
                break;

            case 'unpublished':
                this.logger.log(
                    `Master ${masterId} unpublished → Setting to draft in Medusa`,
                );

                const mapping = await this.mappingRepo.findByPimMasterId(masterId);
                if (!mapping || !mapping.medusaProductId) {
                    this.logger.warn(`No mapping found for unpublished master ${masterId}`);
                    return;
                }

                await this.medusaClient.setProductToDraft(mapping.medusaProductId);

                await this.mappingRepo.update(masterId, {
                    lastSyncAction: 'updated',
                    lastSyncedAt: new Date(),
                });
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

