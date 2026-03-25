import { Injectable, Logger } from '@nestjs/common';
// PIMCLIENT: Removed to enforce MSA boundary - no sync calls between internal services
// import { PimClient } from './pim.client';
import { MedusaClient } from './medusa.client';
import { PimMedusaMappingRepository } from './pim-medusa-mapping.repository';
import { transformPimToMedusa, validatePimSnapshot } from './transformers/pim-to-medusa.transformer';
import type { PimActiveVersionChangedEvent, PimProductSnapshot, MedusaProduct } from '../../types';
// PIMCLIENT: Type import removed
// import type { PimCategoryDetail } from './pim.client';
import type { CategoryChangedPayload } from '@packages/event-contracts/streams/product.stream';

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
    // PIMCLIENT: Removed to enforce MSA boundary - no sync calls between internal services
    // private readonly pimClient: PimClient,
    private readonly medusaClient: MedusaClient,
    private readonly mappingRepo: PimMedusaMappingRepository,
  ) {}

  // PIMCLIENT: This method is disabled because it calls PIM API (this.pimClient.getCategory)
  // PIMCLIENT: Use ensureMedusaCategoriesFromSnapshot() instead (event-driven approach)
  // // PIM 카테고리를 Medusa에 보장(부모까지 생성) 후 Medusa category ID 배열 반환
  // private async ensureMedusaCategories(
  //   categoryIds: string[] | undefined,
  // ): Promise<Array<{ id: string; pimCategoryId: string }>> {
  //   if (!categoryIds || categoryIds.length === 0) {
  //     return [];
  //   }
  //
  //   const detailCache = new Map<string, PimCategoryDetail>();
  //   const resolveCategory = async (id: string): Promise<PimCategoryDetail> => {
  //     if (detailCache.has(id)) {
  //       return detailCache.get(id)!;
  //     }
  //     const detail = await this.pimClient.getCategory(id);
  //     detailCache.set(id, detail);
  //     return detail;
  //   };
  //
  //   const medusaIds: Array<{ id: string; pimCategoryId: string }> = [];
  //   for (const categoryId of [...new Set(categoryIds)]) {
  //     const medusaCategoryId = await this.medusaClient.ensureCategoryTree(
  //       categoryId,
  //       resolveCategory,
  //     );
  //     medusaIds.push({ id: medusaCategoryId, pimCategoryId: categoryId });
  //   }
  //   return medusaIds;
  // }

  // PIM 태그 문자열을 Medusa에 보장 후 {id,value} 배열 반환
  private async ensureMedusaTags(tags: string[] | undefined): Promise<Array<{ value: string; id: string }>> {
    if (!tags || tags.length === 0) {
      return [];
    }

    const uniqueTags = [...new Set(tags)];
    const ensured = await this.medusaClient.ensureTags(uniqueTags);
    return ensured;
  }

  // PIMCLIENT: This method is disabled because it calls PIM API (this.pimClient.getActiveVersion)
  // PIMCLIENT: Use event-driven sync via handleActiveVersionChanged() -> syncFromSnapshot() instead
  // PIMCLIENT: Only kept for migration scripts in /scripts directory
  // // 단일 Master 동기화 (Main Entry Point - mapping 기반)
  // async syncMaster(masterId: string, versionIdToCheck?: string): Promise<SyncResult> {
  //   this.logger.log(`Starting sync for PIM master: ${masterId}`);
  //
  //   try {
  //     // 1. PIM Active Version 조회
  //     const snapshot = await this.pimClient.getActiveVersion(masterId);
  //
  //     if (!snapshot || !snapshot.versionId) {
  //       this.logger.warn(`No active version for master ${masterId}`);
  //       return {
  //         success: true,
  //         masterId,
  //         action: 'skipped',
  //       };
  //     }
  //
  //     // shouldProcess 체크
  //     if (versionIdToCheck) {
  //       const shouldProcess = await this.mappingRepo.shouldProcessVersionId(
  //         masterId,
  //         versionIdToCheck,
  //       );
  //       if (!shouldProcess) {
  //         return {
  //           success: true,
  //           masterId,
  //           action: 'skipped',
  //         };
  //       }
  //     }
  //
  //     // 3. 검증
  //     validatePimSnapshot(snapshot);
  //
  //     this.logger.debug(`PIM snapshot categoryIds: ${JSON.stringify(snapshot.categoryIds)}`);
  //
  //     // 3-1. 카테고리/태그 보장 (Medusa에 없으면 생성)
  //     const medusaCategories = await this.ensureMedusaCategories(
  //       snapshot.categoryIds,
  //     );
  //     const medusaTags = await this.ensureMedusaTags(snapshot.tags);
  //
  //     // 3-2. Product Type & Sales Channel (Simplified)
  //     const medusaTypeId = await this.medusaClient.ensureProductType(
  //       snapshot.productType || 'Unknown',
  //     );
  //     const defaultSalesChannelId = await this.medusaClient.getDefaultSalesChannel();
  //
  //     // 4. Medusa Payload로 변환
  //     const medusaPayload = transformPimToMedusa(snapshot, {
  //       categories: medusaCategories.map(({ id }) => ({ id })),
  //       tags: medusaTags,
  //       type_id: medusaTypeId,
  //       sales_channels: [defaultSalesChannelId],
  //     });
  //
  //     // 5. 기존 매핑 조회
  //     const existingMapping = await this.mappingRepo.findByPimMasterId(masterId);
  //     const medusaProductId = existingMapping?.medusaProductId ?? undefined;
  //
  //     // 6. Medusa에 Upsert
  //     const { product, action } = await this.medusaClient.upsertProduct(
  //       medusaPayload,
  //       medusaProductId,
  //     );
  //
  //     this.logger.debug(`medusaCategories for ${product.id}: ${JSON.stringify(medusaCategories)}`);
  //
  //     // 6-1. 카테고리 매핑 보강: join 테이블 확실히 삽입
  //     if (medusaCategories && medusaCategories.length > 0) {
  //       this.logger.log(`Attaching ${medusaCategories.length} categories to product ${product.id}`);
  //       for (const cat of medusaCategories) {
  //         try {
  //           await this.medusaClient.attachProductToCategories(
  //             product.id,
  //             [cat.id],
  //             { throwOnFailure: true },
  //           );
  //         } catch (err: any) {
  //           const status = err?.response?.status;
  //           const errType = err?.response?.data?.type;
  //           const errMsg = err?.message || '';
  //           const is404 =
  //             status === 404 ||
  //             errType === 'not_found' ||
  //             /404/i.test(errMsg) ||
  //             /not found/i.test(errMsg);
  //
  //           if (is404) {
  //             this.logger.warn(
  //               `Category ${cat.id} missing in Medusa, re-ensuring from PIM (${cat.pimCategoryId})`,
  //             );
  //
  //             // PIM 카테고리 ID로 다시 생성/조회
  //             const refreshedId =
  //               await this.medusaClient.ensureCategoryTree(
  //                 cat.pimCategoryId,
  //                 (id) => this.pimClient.getCategory(id),
  //               );
  //
  //             // 재생성된 카테고리 ID로 재시도
  //             try {
  //               await this.medusaClient.attachProductToCategories(
  //                 product.id,
  //                 [refreshedId],
  //                 { throwOnFailure: false },
  //               );
  //               this.logger.log(
  //                 `Successfully attached product ${product.id} to re-ensured category ${refreshedId}`,
  //               );
  //             } catch (retryErr: any) {
  //               this.logger.error(
  //                 `Failed to attach product ${product.id} to re-ensured category ${refreshedId}: ${retryErr?.message}`,
  //               );
  //             }
  //           } else {
  //             this.logger.warn(
  //               `Failed to attach product ${product.id} to category ${cat.id}: ${err?.response?.data?.message || errMsg}`,
  //             );
  //           }
  //         }
  //       }
  //     }
  //
  //     this.logger.log(
  //       `Sync completed: ${masterId} → Medusa ${product.id} (${action})`,
  //     );
  //
  //     // 7. 가격 정책(Price List) 동기화
  //     await this.syncPriceLists(snapshot, product.id, product.variants);
  //
  //     // 8. 매핑 테이블 업데이트
  //     await this.mappingRepo.recordSuccess(masterId, {
  //       pimVersionId: snapshot.versionId,
  //       pimVersion: snapshot.version,
  //       medusaProductId: product.id,
  //       medusaHandle: medusaPayload.handle,
  //       action,
  //     });
  //
  //     return {
  //       success: true,
  //       masterId,
  //       medusaProductId: product.id,
  //       action,
  //     };
  //   } catch (error) {
  //     this.logger.error(
  //       `Sync failed for master ${masterId}`,
  //       error.stack,
  //     );
  //
  //     // 실패 기록
  //     try {
  //       const snapshot = await this.pimClient.getActiveVersion(masterId);
  //       if (snapshot && snapshot.versionId) {
  //         await this.mappingRepo.recordFailure(masterId, {
  //           pimVersionId: snapshot.versionId,
  //           pimVersion: snapshot.version,
  //           error: error.message,
  //         });
  //       }
  //     } catch (recordError) {
  //       this.logger.error('Failed to record failure', recordError);
  //     }
  //
  //     throw error;
  //   }
  // }

  // PIMCLIENT: This method is disabled because it calls syncMaster which uses PIM API
  // PIMCLIENT: Only kept for migration scripts in /scripts directory
  // // 여러 Masters 일괄 동기화
  // async syncMultipleMasters(masterIds: string[]): Promise<SyncResult[]> {
  //   this.logger.log(`Syncing ${masterIds.length} PIM masters...`);
  //
  //   const results: SyncResult[] = [];
  //
  //   for (const masterId of masterIds) {
  //     const result = await this.syncMaster(masterId);
  //     results.push(result);
  //
  //     await new Promise((resolve) => setTimeout(resolve, 100));
  //   }
  //
  //   const successCount = results.filter((r) => r.success).length;
  //   const failCount = results.length - successCount;
  //
  //   this.logger.log(
  //     `Batch sync completed: ${successCount} success, ${failCount} failed`,
  //   );
  //
  //   return results;
  // }

  // PIMCLIENT: This method is disabled because it calls PIM API (this.pimClient.getAllActiveMasters)
  // PIMCLIENT: Only kept for migration scripts in /scripts directory
  // // 전체 Active Masters 동기화
  // async syncAllActiveMasters(): Promise<SyncResult[]> {
  //   this.logger.log('🔄 Starting full sync of all active PIM masters...');
  //
  //   try {
  //     const masterIds = await this.pimClient.getAllActiveMasters();
  //
  //     this.logger.log(`Found ${masterIds.length} active masters to sync`);
  //
  //     const results = await this.syncMultipleMasters(masterIds);
  //
  //     return results;
  //   } catch (error) {
  //     this.logger.error('Full sync failed', error.stack);
  //     throw error;
  //   }
  // }

  // 스냅샷 기반 동기화 (Phase 2 - PIM API 호출 없음)
  async syncFromSnapshot(snapshot: PimProductSnapshot, options?: { skipCategorySync?: boolean }): Promise<SyncResult> {
    const { masterId, versionId } = snapshot;

    this.logger.log(`Syncing from event snapshot: ${masterId} (v${snapshot.version})`);

    try {
      validatePimSnapshot(snapshot);

      this.logger.debug(`PIM snapshot categoryIds: ${JSON.stringify(snapshot.categoryIds)}`);

      const shouldSyncCategories = !options?.skipCategorySync;
      const medusaCategories = shouldSyncCategories
        ? await this.ensureMedusaCategoriesFromSnapshot(snapshot.categories || [])
        : [];
      const medusaTags = await this.ensureMedusaTags(snapshot.tags);

      const medusaTypeId = await this.medusaClient.ensureProductType(snapshot.productType || 'Unknown');
      const defaultSalesChannelId = await this.medusaClient.getDefaultSalesChannel();

      const medusaPayload = transformPimToMedusa(snapshot, {
        ...(shouldSyncCategories ? { categories: medusaCategories.map(({ id }) => ({ id })) } : {}),
        tags: medusaTags,
        type_id: medusaTypeId,
        sales_channels: [defaultSalesChannelId],
      });

      const existingMapping = await this.mappingRepo.findByPimMasterId(masterId);
      const medusaProductId = existingMapping?.medusaProductId ?? undefined;

      const { product, action } = await this.medusaClient.upsertProduct(medusaPayload, medusaProductId);

      this.logger.debug(`medusaCategories for ${product.id}: ${JSON.stringify(medusaCategories)}`);

      if (shouldSyncCategories && medusaCategories && medusaCategories.length > 0) {
        this.logger.log(`Attaching ${medusaCategories.length} categories to product ${product.id}`);

        // 먼저 각 카테고리의 유효한 Medusa ID를 확보 (없으면 재생성)
        const resolvedCategoryIds: string[] = [];
        for (const cat of medusaCategories) {
          try {
            const exists = await this.medusaClient['getCategoryById'](cat.id);
            if (exists) {
              resolvedCategoryIds.push(cat.id);
            } else {
              this.logger.warn(
                `Category ${cat.id} missing in Medusa, re-ensuring from snapshot (${cat.pimCategoryId})`,
              );
              const categorySnapshot = snapshot.categories?.find((c) => c.id === cat.pimCategoryId);
              if (categorySnapshot) {
                const refreshedId = await this.medusaClient.ensureCategoryFromSnapshot(categorySnapshot);
                resolvedCategoryIds.push(refreshedId);
              }
            }
          } catch (err: any) {
            this.logger.warn(`Failed to resolve category ${cat.id}: ${err?.message}`);
          }
        }

        // 모든 카테고리를 한 번에 붙임 (개별 호출 시 덮어쓰기 문제 방지)
        if (resolvedCategoryIds.length > 0) {
          await this.medusaClient.attachProductToCategories(product.id, resolvedCategoryIds, { throwOnFailure: false });
        }
      }

      this.logger.log(`Sync completed: ${masterId} → Medusa ${product.id} (${action})`);

      await this.syncPriceLists(snapshot, product.id, product.variants);

      await this.mappingRepo.recordSuccess(masterId, {
        pimVersionId: versionId,
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
      this.logger.error(`Sync failed for master ${masterId}`, error.stack);

      try {
        await this.mappingRepo.recordFailure(masterId, {
          pimVersionId: versionId,
          pimVersion: snapshot.version,
          error: error.message,
        });
      } catch (recordError) {
        this.logger.error('Failed to record failure', recordError);
      }

      throw error;
    }
  }

  // 스냅샷 기반 카테고리 보장 (PIM API 호출 없음)
  private async ensureMedusaCategoriesFromSnapshot(
    categories: Array<{
      id: string;
      name: string;
      slug: string;
      path: string;
      parentId: string | null;
      isActive: boolean;
      visibility: boolean;
      showOnMainCategory: boolean;
      thumbnail?: string;
    }>,
  ): Promise<Array<{ id: string; pimCategoryId: string }>> {
    const medusaIds: Array<{ id: string; pimCategoryId: string }> = [];

    for (const category of categories) {
      const medusaCategoryId = await this.medusaClient.ensureCategoryFromSnapshot(category);
      medusaIds.push({ id: medusaCategoryId, pimCategoryId: category.id });
    }

    return medusaIds;
  }

  // 이벤트 기반 동기화(Kafka 컨슈머용 - unpublished는 draft로)
  async handleActiveVersionChanged(event: PimActiveVersionChangedEvent): Promise<void> {
    const { masterId, versionId, changeReason, snapshot } = event;

    this.logger.log(`📨 PIM Event: ${masterId} (${changeReason}) - versionId: ${versionId ?? 'none'}`);

    switch (changeReason) {
      case 'published':
      case 'rollback':
        // PIMCLIENT: Strict enforcement - snapshot is mandatory (no PIM API fallback)
        if (!snapshot) {
          const error = new Error(
            `CRITICAL: Snapshot missing for ${changeReason} event (masterId: ${masterId}, versionId: ${versionId}). ` +
              `PIM service MUST include snapshot in events. Fallback to PIM API is disabled to enforce MSA boundary.`,
          );
          this.logger.error(error.message);
          throw error;
        }
        await this.syncFromSnapshot(snapshot);
        break;

      case 'unpublished':
        this.logger.log(`Master ${masterId} unpublished → Setting to draft in Medusa`);

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

  // PIMCLIENT: PIM health check removed - only check Medusa (external dependency)
  // PIMCLIENT: PIM is internal MSA service, check via event flow instead
  async healthCheck(): Promise<{
    pim: boolean;
    medusa: boolean;
    overall: boolean;
  }> {
    // PIMCLIENT: Removed PIM API health check
    // const pim = await this.pimClient.healthCheck();
    const medusa = await this.medusaClient.healthCheck();
    const pim = true; // Assume PIM is healthy, verified via event flow
    const overall = medusa; // Only Medusa status matters for sync capability

    this.logger.log(`Health check - PIM: ${pim} (via events), Medusa: ${medusa}`);

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
      const medusaVariant = medusaVariants.find((mv) => mv.metadata?.pimVariantId === variant.id);
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
        rules: { 'customer.groups.id': [MEMBERSHIP_GROUP_ID] },
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

  /**
   * Handle CategoryChanged event from PIM
   */
  async handleCategoryChanged(event: CategoryChangedPayload): Promise<SyncResult> {
    const { categoryId, changeType, category } = event;

    this.logger.log(`Processing CategoryChanged: ${categoryId} (${changeType})`);

    try {
      // Handle delete
      if (changeType === 'deleted' || category === null) {
        await this.handleCategoryDelete(categoryId);
        return {
          success: true,
          masterId: categoryId,
          action: 'unpublished',
        };
      }

      // Handle create/update/moved (all treated as upsert)
      const medusaCategoryId = await this.medusaClient.ensureCategoryFromSnapshot({
        id: category.id,
        name: category.name,
        slug: category.slug,
        path: category.path,
        parentId: category.parentId,
        isActive: category.isActive,
        visibility: category.visibility,
        showOnMainCategory: category.displaySettings?.showOnMainCategory ?? false,
        thumbnail: category.thumbnail ?? undefined,
        sortOrder: category.sortOrder,
      });

      this.logger.log(`Category synced to Medusa: PIM=${categoryId} → Medusa=${medusaCategoryId}`);

      return {
        success: true,
        masterId: categoryId,
        medusaProductId: medusaCategoryId,
        action: changeType === 'created' ? 'created' : 'updated',
      };
    } catch (error) {
      this.logger.error(`Failed to sync category ${categoryId} to Medusa`, error.stack);
      throw error;
    }
  }

  /**
   * Handle category deletion in Medusa
   */
  private async handleCategoryDelete(pimCategoryId: string): Promise<void> {
    try {
      const handle = `${pimCategoryId}`;
      const existing = await this.medusaClient['findCategoryByHandle'](handle);

      if (existing?.id) {
        // Mark as inactive (soft delete)
        await this.medusaClient['client'].post(`/product-categories/${existing.id}`, { is_active: false });

        // Invalidate cache
        this.medusaClient['categoryCache'].delete(handle);

        this.logger.log(`Marked Medusa category as inactive: ${existing.id}`);
      } else {
        this.logger.debug(`Category ${pimCategoryId} not found in Medusa`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete category ${pimCategoryId} from Medusa`, error.stack);
      throw error;
    }
  }
}
