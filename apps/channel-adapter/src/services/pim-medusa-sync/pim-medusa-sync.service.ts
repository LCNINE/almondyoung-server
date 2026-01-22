import { Injectable, Logger } from '@nestjs/common';
import { PimClient } from './pim.client';
import { MedusaClient } from './medusa.client';
import { PimMedusaMappingRepository } from './pim-medusa-mapping.repository';
import {
    transformPimToMedusa,
    validatePimSnapshot,
} from './pim-to-medusa.transformer';
import type {
    PimActiveVersionChangedEvent,
    PimProductSnapshot,
    MedusaProduct,
} from '../../types';
import type { PimCategoryDetail } from './pim.client';

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

    // PIM 카테고리를 Medusa에 보장(부모까지 생성) 후 Medusa category ID 배열 반환
    private async ensureMedusaCategories(
        categoryIds: string[] | undefined,
    ): Promise<Array<{ id: string; pimCategoryId: string }>> {
        if (!categoryIds || categoryIds.length === 0) {
            return [];
        }

        const detailCache = new Map<string, PimCategoryDetail>();
        const resolveCategory = async (id: string): Promise<PimCategoryDetail> => {
            if (detailCache.has(id)) {
                return detailCache.get(id)!;
            }
            const detail = await this.pimClient.getCategory(id);
            detailCache.set(id, detail);
            return detail;
        };

        const medusaIds: Array<{ id: string; pimCategoryId: string }> = [];
        for (const categoryId of [...new Set(categoryIds)]) {
            const medusaCategoryId = await this.medusaClient.ensureCategoryTree(
                categoryId,
                resolveCategory,
            );
            medusaIds.push({ id: medusaCategoryId, pimCategoryId: categoryId });
        }
        return medusaIds;
    }

    // PIM 태그 문자열을 Medusa에 보장 후 {id,value} 배열 반환
    private async ensureMedusaTags(
        tags: string[] | undefined,
    ): Promise<Array<{ value: string; id: string }>> {
        if (!tags || tags.length === 0) {
            return [];
        }

        const uniqueTags = [...new Set(tags)];
        const ensured = await this.medusaClient.ensureTags(uniqueTags);
        return ensured;
    }

    // 단일 Master 동기화 (Main Entry Point - mapping 기반)
    async syncMaster(masterId: string, versionIdToCheck?: string): Promise<SyncResult> {
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
            if (versionIdToCheck) {
                const shouldProcess = await this.mappingRepo.shouldProcessVersionId(
                    masterId,
                    versionIdToCheck,
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

            this.logger.debug(`PIM snapshot categoryIds: ${JSON.stringify(snapshot.categoryIds)}`);

            // 3-1. 카테고리/태그 보장 (Medusa에 없으면 생성)
            const medusaCategories = await this.ensureMedusaCategories(
                snapshot.categoryIds,
            );
            const medusaTags = await this.ensureMedusaTags(snapshot.tags);

            // 3-2. Product Type & Sales Channel (Simplified)
            const medusaTypeId = await this.medusaClient.ensureProductType(
                snapshot.productType || 'Unknown',
            );
            const defaultSalesChannelId = await this.medusaClient.getDefaultSalesChannel();

            // 4. Medusa Payload로 변환
            const medusaPayload = transformPimToMedusa(snapshot, {
                categories: medusaCategories.map(({ id }) => ({ id })),
                tags: medusaTags,
                type_id: medusaTypeId,
                sales_channels: [defaultSalesChannelId],
            });

            // 5. 기존 매핑 조회
            const existingMapping = await this.mappingRepo.findByPimMasterId(masterId);
            const medusaProductId = existingMapping?.medusaProductId ?? undefined;

            // 6. Medusa에 Upsert
            const { product, action } = await this.medusaClient.upsertProduct(
                medusaPayload,
                medusaProductId,
            );

            this.logger.debug(`medusaCategories for ${product.id}: ${JSON.stringify(medusaCategories)}`);

            // 6-1. 카테고리 매핑 보강: join 테이블 확실히 삽입
            if (medusaCategories && medusaCategories.length > 0) {
                this.logger.log(`Attaching ${medusaCategories.length} categories to product ${product.id}`);
                for (const cat of medusaCategories) {
                    try {
                        await this.medusaClient.attachProductToCategories(
                            product.id,
                            [cat.id],
                            { throwOnFailure: true },
                        );
                    } catch (err: any) {
                        const status = err?.response?.status;
                        const errType = err?.response?.data?.type;
                        const errMsg = err?.message || '';
                        const is404 =
                            status === 404 ||
                            errType === 'not_found' ||
                            /404/i.test(errMsg) ||
                            /not found/i.test(errMsg);

                        if (is404) {
                            this.logger.warn(
                                `Category ${cat.id} missing in Medusa, re-ensuring from PIM (${cat.pimCategoryId})`,
                            );

                            // PIM 카테고리 ID로 다시 생성/조회
                            const refreshedId =
                                await this.medusaClient.ensureCategoryTree(
                                    cat.pimCategoryId,
                                    (id) => this.pimClient.getCategory(id),
                                );

                            // 재생성된 카테고리 ID로 재시도
                            try {
                                await this.medusaClient.attachProductToCategories(
                                    product.id,
                                    [refreshedId],
                                    { throwOnFailure: false },
                                );
                                this.logger.log(
                                    `Successfully attached product ${product.id} to re-ensured category ${refreshedId}`,
                                );
                            } catch (retryErr: any) {
                                this.logger.error(
                                    `Failed to attach product ${product.id} to re-ensured category ${refreshedId}: ${retryErr?.message}`,
                                );
                            }
                        } else {
                            this.logger.warn(
                                `Failed to attach product ${product.id} to category ${cat.id}: ${err?.response?.data?.message || errMsg}`,
                            );
                        }
                    }
                }
            }

            this.logger.log(
                `Sync completed: ${masterId} → Medusa ${product.id} (${action})`,
            );

            // 7. 가격 정책(Price List) 동기화
            await this.syncPriceLists(snapshot, product.id, product.variants);

            // 8. 매핑 테이블 업데이트
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

            throw error;
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
        const { masterId, versionId, changeReason } = event;

        this.logger.log(
            `📨 PIM Event: ${masterId} (${changeReason}) - versionId: ${versionId ?? 'none'}`,
        );

        // changeReason에 따라 처리
        switch (changeReason) {
            case 'published':
            case 'rollback':
                if (!versionId) {
                    this.logger.error(`versionId is null for published/rollback event`);
                    return;
                }
                await this.syncMaster(masterId, versionId);
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

    private async syncPriceLists(
        snapshot: PimProductSnapshot,
        medusaProductId: string,
        medusaVariants?: MedusaProduct['variants'],
    ): Promise<void> {
        if (!medusaVariants || medusaVariants.length === 0) return;

        const MEMBERSHIP_GROUP_ID = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
        const membershipPrices: any[] = [];
        const tieredPricesMap = new Map<number, any[]>(); // minQuantity -> prices

        // 1. 가격 데이터 수집
        for (const variant of snapshot.variants) {
            const medusaVariant = medusaVariants.find(
                (mv) => mv.metadata?.pimVariantId === variant.id
            );
            if (!medusaVariant) continue;

            // 멤버십 가격
            if (variant.membershipPrice && MEMBERSHIP_GROUP_ID) {
                membershipPrices.push({
                    amount: Math.round(variant.membershipPrice),
                    currency_code: 'krw',
                    variant_id: medusaVariant.id,
                });
            }

            // Tier 가격
            if (variant.tieredPrices && variant.tieredPrices.length > 0) {
                for (const tier of variant.tieredPrices) {
                    const list = tieredPricesMap.get(tier.minQuantity) || [];
                    list.push({
                        amount: Math.round(tier.price),
                        currency_code: 'krw',
                        variant_id: medusaVariant.id,
                        min_quantity: tier.minQuantity,
                    });
                    tieredPricesMap.set(tier.minQuantity, list);
                }
            }
        }

        // 2. Membership Price List 동기화
        if (membershipPrices.length > 0 && MEMBERSHIP_GROUP_ID) {
            const listId = await this.medusaClient.ensurePriceList({
                name: 'Membership Prices',
                description: 'Prices for membership customers',
                type: 'sale',
                status: 'active',
                rules: { customer_group_id: [MEMBERSHIP_GROUP_ID] },
            });
            await this.medusaClient.addPricesToPriceList(listId, membershipPrices);
        }

        // 3. Tiered Price Lists 동기화
        for (const [minQty, prices] of tieredPricesMap.entries()) {
            const listId = await this.medusaClient.ensurePriceList({
                name: `Tiered Prices - Min ${minQty}`,
                description: `Bulk discount for quantity ${minQty}+`,
                type: 'sale',
                status: 'active',
            });
            await this.medusaClient.addPricesToPriceList(listId, prices);
        }
    }
}
