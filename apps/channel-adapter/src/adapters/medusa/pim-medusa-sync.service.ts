import { Injectable, Logger } from '@nestjs/common';
// PIMCLIENT: Removed to enforce MSA boundary - no sync calls between internal services
// import { PimClient } from './pim.client';
import { MedusaClient } from './medusa.client';
import { PimMedusaMappingRepository } from './pim-medusa-mapping.repository';
import { transformPimToMedusa, validatePimSnapshot } from './transformers/pim-to-medusa.transformer';
import type { PimActiveVersionChangedEvent, PimProductSnapshot, MedusaProduct } from '../../types';
// PIMCLIENT: Type import removed
// import type { PimCategoryDetail } from './pim.client';
import type {
  CategoryChangedPayload,
  ProductMasterDeletedPayload,
} from '@packages/event-contracts/streams/product.stream';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';

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

    // variant 가 0 개인 master 는 fail 이 아니라 skip (data 상 빈 master — 재시도해도 같음).
    // validatePimSnapshot 도 같은 케이스를 던지지만, 그 전에 가로채서 카운트를
    // skippedCount 로 분류하는 편이 운영자 입장에서 명확.
    if (!snapshot.variants || snapshot.variants.length === 0) {
      this.logger.warn(`Skipping ${masterId}: snapshot has no variants (orphan master)`);
      return { success: true, masterId, action: 'skipped' };
    }

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
      const fulfillmentKind = snapshot.fulfillmentKind ?? 'physical';
      const shippingProfileId =
        fulfillmentKind === 'physical' ? await this.medusaClient.getDefaultShippingProfileId() : null;

      // 같은 product 의 snapshot 안에서 다른 카테고리의 부모인 항목(=루트 또는 중간 노드)은
      // attach 에서 제외한다. 같은 카테고리에 모든 product 가 동시에 attach 하면 Medusa
      // 서버측 row lock 으로 직렬화되어 concurrency 가 죽는데, leaf 만 attach 하면
      // product 마다 attach 대상이 거의 겹치지 않아 진짜 병렬이 살아난다. storefront 의 부모
      // 카테고리 필터는 product_categories tree traversal 로 leaf attach 만으로도 잘 동작.
      const allSnapshotCats = snapshot.categories || [];
      const referencedAsParent = new Set<string>(
        allSnapshotCats.map((c) => c.parentId).filter((p): p is string => !!p),
      );
      const explicitSkipIds = new Set(
        (process.env.SKIP_ATTACH_CATEGORY_IDS || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
      const explicitSkipSlugs = new Set(
        (process.env.SKIP_ATTACH_CATEGORY_SLUGS || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
      const isAttachable = (pimCategoryId: string) => {
        if (referencedAsParent.has(pimCategoryId)) return false; // non-leaf
        if (explicitSkipIds.has(pimCategoryId)) return false;
        const c = allSnapshotCats.find((x) => x.id === pimCategoryId);
        if (!c) return true;
        if (c.parentId == null) return false; // root
        if (c.slug && explicitSkipSlugs.has(c.slug)) return false; // 환경변수로 명시 제외 (예: 전체상품 보기)
        return true;
      };
      const attachableCategories = medusaCategories.filter((c) => isAttachable(c.pimCategoryId));

      const medusaPayload = transformPimToMedusa(snapshot, {
        ...(shouldSyncCategories ? { categories: attachableCategories.map(({ id }) => ({ id })) } : {}),
        tags: medusaTags,
        type_id: medusaTypeId,
        shipping_profile_id: shippingProfileId,
        sales_channels: [defaultSalesChannelId],
      });

      const existingMapping = await this.mappingRepo.findByPimMasterId(masterId);
      const medusaProductId = existingMapping?.medusaProductId ?? undefined;

      const { product, action } = await this.medusaClient.upsertProduct(medusaPayload, medusaProductId);

      if (shouldSyncCategories && attachableCategories.length > 0) {
        // 추가 verify 는 attachProductToCategories 내부 verify 와 중복이라 제거.
        // attach 측은 categoryCache 를 우선 사용하고, miss 와 attach 호출은 Medusa 보호를 위해 순차 실행한다.
        const resolvedCategoryIds = attachableCategories.map((c) => c.id);
        await this.medusaClient.attachProductToCategories(product.id, resolvedCategoryIds, { throwOnFailure: false });
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
        await this.draftMappedProduct(masterId, 'unpublished');
        break;

      default:
        this.logger.warn(`Unknown changeReason: ${changeReason}`);
    }
  }

  async handleProductMasterDeleted(event: ProductMasterDeletedPayload): Promise<void> {
    this.logger.log(`Master ${event.masterId} deleted → Setting mapped Medusa product to draft`);
    await this.draftMappedProduct(event.masterId, 'deleted');
  }

  private async draftMappedProduct(masterId: string, reason: 'unpublished' | 'deleted'): Promise<void> {
    const mapping = await this.mappingRepo.findByPimMasterId(masterId);
    if (!mapping || !mapping.medusaProductId) {
      this.logger.warn(`No mapping found for ${reason} master ${masterId}`);
      return;
    }

    await this.medusaClient.setProductToDraft(mapping.medusaProductId);

    await this.mappingRepo.update(masterId, {
      lastSyncAction: 'updated',
      lastSyncedAt: new Date(),
    });
  }

  async handleProductSellableQuantityChanged(payload: ProductSellableQuantityChangedPayload): Promise<void> {
    if (!payload.masterId) {
      throw new Error(
        `ProductSellableQuantityChanged missing masterId for variant ${payload.variantId}; cannot resolve Medusa product`,
      );
    }

    let medusaProductId: string | undefined;
    const mapping = await this.mappingRepo.findByPimMasterId(payload.masterId);
    if (mapping?.medusaProductId) {
      medusaProductId = mapping.medusaProductId;
    } else {
      const product = await this.medusaClient.findProductByHandle(payload.masterId);
      medusaProductId = product?.id;
    }

    if (!medusaProductId) {
      throw new Error(
        `Medusa product not found for ProductSellableQuantityChanged masterId=${payload.masterId}, ` +
          `variantId=${payload.variantId}`,
      );
    }

    this.logger.log(
      `Applying ProductSellableQuantityChanged to Medusa: masterId=${payload.masterId}, ` +
        `variantId=${payload.variantId}, medusaProductId=${medusaProductId}, ` +
        `sellableQuantity=${payload.sellableQuantity}, reason=${payload.reason ?? 'unknown'}`,
    );

    await this.medusaClient.applyProductSellableQuantityProjection({
      ...payload,
      medusaProductId,
    });

    this.logger.log(
      `ProductSellableQuantityChanged synced to Medusa: masterId=${payload.masterId}, ` +
        `variantId=${payload.variantId}, medusaProductId=${medusaProductId}, ` +
        `sellableQuantity=${payload.sellableQuantity}`,
    );
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
      // 생성 시 handle은 slug 우선(pimCategoryId는 fallback)이라, 삭제에서는
      // metadata.pimCategoryId + legacy handle 두 경로로 조회해야 한다.
      const existing = await this.medusaClient.findCategoryByPimRef(pimCategoryId);

      if (!existing?.id) {
        this.logger.debug(`Category ${pimCategoryId} not found in Medusa`);
        return;
      }

      await this.medusaClient.softDeleteCategory(existing.id);
      if (existing.handle) {
        this.medusaClient.invalidateCategoryCacheByHandle(existing.handle);
      }
      this.logger.log(`Marked Medusa category as inactive: ${existing.id} (handle=${existing.handle})`);
    } catch (error) {
      this.logger.error(`Failed to delete category ${pimCategoryId} from Medusa`, error.stack);
      throw error;
    }
  }
}
