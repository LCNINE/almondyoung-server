import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Medusa from '@medusajs/js-sdk';
import type { FetchError } from '@medusajs/js-sdk';
import type { HttpTypes } from '@medusajs/types';
import { createMedusaSdk } from './medusa-sdk.config';
import type { MedusaProductPayload, MedusaProduct } from '../../types';
import type { PimCategoryDetail } from './pim.client';

export interface MedusaOrder {
  id: string;
  email?: string;
  customer_id?: string;
  currency_code?: string;
  total?: number;
  subtotal?: number;
  shipping_total?: number;
  discount_total?: number;
  created_at?: string;
  updated_at?: string;
  items?: Array<{
    id: string;
    title?: string;
    quantity?: number;
    unit_price?: number;
    variant_id?: string;
    variant?: {
      id?: string;
      title?: string;
      metadata?: Record<string, unknown>;
      product?: {
        id?: string;
        metadata?: Record<string, unknown>;
      };
    };
  }>;
  shipping_address?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    postal_code?: string;
    address_1?: string;
    address_2?: string;
  };
}

@Injectable()
export class MedusaClient {
  private readonly logger = new Logger(MedusaClient.name);
  private readonly sdk: Medusa;
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly categoryCache = new Map<string, MedusaProduct['id']>(); // key: handle
  private readonly tagCache = new Map<string, string>(); // key: value
  private readonly typeCache = new Map<string, string>(); // key: value
  private readonly salesChannelCache = new Map<string, string>(); // key: name
  // 대용량 상품일 때 한번에 보내는 variants 수를 제한 (unknown_error 완화 목적)
  private readonly MAX_VARIANTS_PER_REQUEST = 30;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('MEDUSA_API_URL') || '';
    this.apiKey = this.configService.get<string>('MEDUSA_API_KEY') || '';

    if (!this.apiUrl) {
      throw new Error('MEDUSA_API_URL is not set. Cannot initialize Medusa SDK.');
    }

    // Initialize Medusa SDK (handles authentication automatically)
    this.sdk = createMedusaSdk(configService);

    this.logger.log(`Medusa SDK initialized: ${this.apiUrl}`);
  }

  // 모든 캐시 초기화 (마이그레이션 시작 시 사용)
  clearAllCaches(): void {
    this.categoryCache.clear();
    this.tagCache.clear();
    this.typeCache.clear();
    this.salesChannelCache.clear();
    this.logger.log('All caches cleared');
  }

  // ===== Product Categories =====
  // Note: These normalizers may be removed after testing confirms SDK consistency
  private normalizeCategoryListResponse(resp: {
    product_categories?: HttpTypes.AdminProductCategory[];
  }): HttpTypes.AdminProductCategory[] {
    // SDK already returns normalized format: { product_categories: [...] }
    return resp?.product_categories || [];
  }

  private normalizeCategoryResponse(resp: {
    product_category?: HttpTypes.AdminProductCategory;
  }): HttpTypes.AdminProductCategory | null {
    // SDK already returns normalized format: { product_category: {...} }
    return resp?.product_category || null;
  }

  private async getCategoryById(id: string): Promise<HttpTypes.AdminProductCategory | null> {
    try {
      const { product_category } = await this.sdk.admin.productCategory.retrieve(id);
      return product_category;
    } catch (error) {
      const fetchError = error as FetchError;
      if (fetchError.status === 404) return null;
      this.logger.warn(`Medusa getCategoryById failed for ${id}: ${fetchError.message}`);
      return null;
    }
  }

  private async findCategoryByHandle(handle: string): Promise<HttpTypes.AdminProductCategory | null> {
    try {
      const { product_categories } = await this.sdk.admin.productCategory.list({
        handle,
      });
      return product_categories?.find((c) => c.handle === handle) || null;
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.warn(`Medusa findCategoryByHandle failed for ${handle}: ${fetchError.message}`);
      return null;
    }
  }

  private async findCategoryByCandidateHandles(
    ...handles: Array<string | null | undefined>
  ): Promise<HttpTypes.AdminProductCategory | null> {
    const uniqueHandles = Array.from(new Set(handles.filter((h): h is string => Boolean(h && h.trim()))));

    for (const handle of uniqueHandles) {
      const found = await this.findCategoryByHandle(handle);
      if (found?.id) {
        return found;
      }
    }

    return null;
  }

  private async findCategoryByPimId(pimCategoryId: string): Promise<HttpTypes.AdminProductCategory | null> {
    try {
      // 카테고리가 많을 수 있으므로 충분히 큰 limit 사용
      const { product_categories } = await this.sdk.admin.productCategory.list({
        limit: 1000,
      });
      return product_categories?.find((c) => (c.metadata as any)?.pimCategoryId === pimCategoryId) || null;
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.warn(`Medusa findCategoryByPimId failed for ${pimCategoryId}: ${fetchError.message}`);
      return null;
    }
  }

  private async createCategory(payload: HttpTypes.AdminCreateProductCategory): Promise<HttpTypes.AdminProductCategory> {
    const { product_category } = await this.sdk.admin.productCategory.create(payload);
    if (!product_category) {
      throw new Error('Medusa API returned no category in response');
    }
    return product_category;
  }

  // 카테고리 보장: PIM 카테고리 트리를 따라 부모→자식 순서로 생성/조회
  async ensureCategoryTree(
    pimCategoryId: string,
    resolver: (id: string) => Promise<PimCategoryDetail>,
  ): Promise<string> {
    const handle = `${pimCategoryId}`;

    // 부모부터 보장
    const detail = await resolver(pimCategoryId);
    let parentMedusaId: string | undefined;
    const isActive = (detail.isActive ?? true) && (detail.visibility ?? true);
    const pimMetadata = {
      pimCategoryId: detail.id,
      pimPath: detail.path,
      pimSlug: detail.slug,
      pimVisibility: detail.visibility ?? true,
      pimShowOnMainCategory: detail.showOnMainCategory ?? false,
    };

    if (detail.parentId) {
      parentMedusaId = await this.ensureCategoryTree(detail.parentId, resolver);
    }

    // 항상 실제 Medusa에서 조회 (캐시 불일치 방지)
    const existing = await this.findCategoryByHandle(handle);
    if (existing?.id) {
      // 실제 존재 여부 재확인 (findCategoryByHandle이 잘못된 결과를 반환할 수 있음)
      const verified = await this.getCategoryById(existing.id);
      if (!verified) {
        this.logger.warn(`Category ${existing.id} found by handle but doesn't exist by ID. Creating new...`);
        // existing을 null로 처리하여 아래 생성 로직으로 이동
      } else {
        const updatePayload = {
          name: detail.name,
          is_internal: false,
          is_active: isActive,
          parent_category_id: parentMedusaId,
          ...(detail.thumbnail && { thumbnail: detail.thumbnail }),
          metadata: {
            ...(existing.metadata || {}),
            ...pimMetadata,
          },
        };
        try {
          await this.sdk.admin.productCategory.update(existing.id, updatePayload);
        } catch (err) {
          const fetchError = err as FetchError;
          this.logger.warn(
            `Failed to update Medusa category ${existing.id} from PIM ${detail.id}: ${fetchError.message}`,
          );
        }
        // 조회 결과를 캐시에 저장 (다음 동일 제품에서 재사용)
        this.categoryCache.set(handle, existing.id);
        this.logger.debug(`Ensured existing Medusa category ${existing.id} for PIM ${pimCategoryId}`);
        return existing.id;
      }
    }

    // 새로 생성
    const payload = {
      name: detail.name,
      handle,
      is_internal: false,
      is_active: isActive,
      parent_category_id: parentMedusaId,
      ...(detail.thumbnail && { thumbnail: detail.thumbnail }),
      metadata: {
        ...pimMetadata,
      },
    };

    const created = await this.createCategory(payload);
    this.categoryCache.set(handle, created.id);
    this.logger.log(`Created Medusa category ${created.id} for PIM category ${detail.id}`);
    return created.id;
  }

  // 스냅샷 기반 카테고리 보장 (Phase 2 - PIM API 호출 없음)
  async ensureCategoryFromSnapshot(categorySnapshot: {
    id: string;
    name: string;
    slug: string;
    path: string;
    parentId: string | null;
    isActive: boolean;
    visibility: boolean;
    showOnMainCategory: boolean;
    thumbnail?: string;
    sortOrder?: number;
  }): Promise<string> {
    const preferredHandle = categorySnapshot.slug || categorySnapshot.id;
    const legacyHandle = categorySnapshot.id;

    const isActive = categorySnapshot.isActive && categorySnapshot.visibility;
    const pimMetadata = {
      pimCategoryId: categorySnapshot.id,
      pimPath: categorySnapshot.path,
      pimSlug: categorySnapshot.slug,
      pimVisibility: categorySnapshot.visibility,
      pimShowOnMainCategory: categorySnapshot.showOnMainCategory,
    };

    // parentMedusaId: null이면 부모 제거, undefined면 찾지 못함
    let parentMedusaId: string | null | undefined;
    this.logger.log(
      `[DEBUG] ensureCategoryFromSnapshot - PIM category: ${categorySnapshot.id}, PIM parentId: ${categorySnapshot.parentId ?? 'null'}`,
    );
    if (categorySnapshot.parentId === null) {
      // 명시적으로 부모 없음 - Medusa에 null 전달하여 부모 제거
      parentMedusaId = null;
      this.logger.log(`[DEBUG] PIM parentId is null - will remove parent in Medusa`);
    } else if (categorySnapshot.parentId) {
      // handle(UUID 또는 slug)로 먼저 조회, 없으면 metadata.pimCategoryId로 fallback
      const existingParent =
        (await this.findCategoryByCandidateHandles(categorySnapshot.parentId)) ||
        (await this.findCategoryByPimId(categorySnapshot.parentId));
      if (existingParent?.id) {
        parentMedusaId = existingParent.id;
        this.logger.log(
          `[DEBUG] Found Medusa parent: ${parentMedusaId} for PIM parentId: ${categorySnapshot.parentId}`,
        );
      } else {
        this.logger.warn(`Parent category ${categorySnapshot.parentId} not found in Medusa, creating without parent`);
      }
    }

    const existing =
      (await this.findCategoryByCandidateHandles(preferredHandle, legacyHandle)) ||
      (await this.findCategoryByPimId(categorySnapshot.id));
    if (existing?.id) {
      const verified = await this.getCategoryById(existing.id);
      if (!verified) {
        // getCategoryById 실패 시 handle 조회 결과를 신뢰 (네트워크 오류일 수 있음)
        this.logger.warn(`Category ${existing.id} found by handle but getCategoryById failed. Using handle result.`);
        this.categoryCache.set(preferredHandle, existing.id);
        return existing.id;
      } else {
        const updatePayload = {
          name: categorySnapshot.name,
          handle: preferredHandle,
          is_internal: false,
          is_active: isActive,
          parent_category_id: parentMedusaId,
          ...(categorySnapshot.thumbnail && { thumbnail: categorySnapshot.thumbnail }),
          ...(categorySnapshot.sortOrder != null && { rank: categorySnapshot.sortOrder }),
          metadata: {
            ...(existing.metadata || {}),
            ...pimMetadata,
          },
        };
        this.logger.log(
          `[DEBUG] Updating Medusa category ${existing.id} with parent_category_id: ${parentMedusaId ?? 'undefined'}`,
        );
        try {
          await this.sdk.admin.productCategory.update(existing.id, updatePayload);
          this.logger.log(`[DEBUG] Successfully updated Medusa category ${existing.id}`);
        } catch (err) {
          const fetchError = err as FetchError;
          this.logger.warn(
            `Failed to update Medusa category ${existing.id} from snapshot ${categorySnapshot.id}: ${fetchError.message}`,
          );
        }
        this.categoryCache.set(preferredHandle, existing.id);
        this.logger.debug(`Ensured existing Medusa category ${existing.id} for PIM ${categorySnapshot.id}`);
        return existing.id;
      }
    }

    // 생성 시에는 parent_category_id가 null이면 undefined로 변환 (API 스펙)
    const payload = {
      name: categorySnapshot.name,
      handle: preferredHandle,
      is_internal: false,
      is_active: isActive,
      parent_category_id: parentMedusaId ?? undefined,
      ...(categorySnapshot.thumbnail && { thumbnail: categorySnapshot.thumbnail }),
      ...(categorySnapshot.sortOrder != null && { rank: categorySnapshot.sortOrder }),
      metadata: {
        ...pimMetadata,
      },
    };

    const created = await this.createCategory(payload);
    this.categoryCache.set(preferredHandle, created.id);
    this.logger.log(`Created Medusa category ${created.id} from snapshot for PIM category ${categorySnapshot.id}`);
    return created.id;
  }

  // 상품을 지정된 카테고리에 강제 매핑 (Medusa v2: 제품 업데이트로 categories 설정)
  async attachProductToCategories(
    productId: string,
    categoryIds: string[],
    options?: { throwOnFailure?: boolean },
  ): Promise<void> {
    if (!categoryIds || categoryIds.length === 0) return;
    const unique = Array.from(new Set(categoryIds));

    // 카테고리 존재 여부 확인
    for (const catId of unique) {
      const categoryExists = await this.getCategoryById(catId);
      if (!categoryExists) {
        this.logger.warn(`Category ${catId} does not exist in Medusa before attaching product ${productId}`);
        if (options?.throwOnFailure) {
          throw new Error(`Category ${catId} not found`);
        }
        return;
      }
    }

    // productCategory.updateProducts로 M:N 조인 테이블에 직접 추가
    // (product.update({ categories }) 는 product record만 업데이트하고 조인 테이블을 갱신하지 않음)
    for (const catId of unique) {
      try {
        await this.sdk.admin.productCategory.updateProducts(catId, {
          add: [productId],
        } as any);
        this.logger.debug(`Attached product ${productId} to category ${catId}`);
      } catch (error) {
        const fetchError = error as FetchError;
        this.logger.warn(`Failed to attach product ${productId} to category ${catId}: ${fetchError.message}`);
        if (options?.throwOnFailure) {
          throw error;
        }
      }
    }
  }

  // ===== Product Tags =====
  // Note: These normalizers may be removed after testing confirms SDK consistency
  private normalizeTagListResponse(resp: { product_tags?: HttpTypes.AdminProductTag[] }): HttpTypes.AdminProductTag[] {
    // SDK already returns normalized format: { product_tags: [...] }
    return resp?.product_tags || [];
  }

  private normalizeTagResponse(resp: { product_tag?: HttpTypes.AdminProductTag }): HttpTypes.AdminProductTag | null {
    // SDK already returns normalized format: { product_tag: {...} }
    return resp?.product_tag || null;
  }

  private async findTagByValue(value: string): Promise<HttpTypes.AdminProductTag | null> {
    try {
      const { product_tags } = await this.sdk.admin.productTag.list({ q: value });
      return product_tags?.find((t) => t.value === value) || null;
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.warn(`Medusa findTagByValue failed for ${value}: ${fetchError.message}`);
      return null;
    }
  }

  private async createTag(value: string): Promise<HttpTypes.AdminProductTag> {
    const { product_tag } = await this.sdk.admin.productTag.create({ value });
    if (!product_tag) {
      throw new Error('Medusa API returned no tag in response');
    }
    return product_tag;
  }

  async ensureTag(value: string): Promise<string> {
    if (!value) {
      throw new Error('Tag value is required');
    }

    if (this.tagCache.has(value)) {
      return this.tagCache.get(value)!;
    }

    const existing = await this.findTagByValue(value);
    if (existing?.id) {
      this.tagCache.set(value, existing.id);
      return existing.id;
    }

    const created = await this.createTag(value);
    this.tagCache.set(value, created.id);
    this.logger.log(`Created Medusa tag "${value}" (${created.id})`);
    return created.id;
  }

  async ensureProductType(value: string): Promise<string> {
    // 캐시 확인
    if (this.typeCache.has(value)) {
      return this.typeCache.get(value)!;
    }

    try {
      // 조회
      const { product_types } = await this.sdk.admin.productType.list({
        q: value,
        limit: 1,
      });

      const existing = product_types?.find((t) => t.value === value);
      if (existing) {
        this.typeCache.set(value, existing.id);
        return existing.id;
      }

      // 생성
      const { product_type } = await this.sdk.admin.productType.create({
        value,
      });
      const newId = product_type.id;
      this.typeCache.set(value, newId);
      this.logger.log(`Created Medusa product type "${value}" (${newId})`);
      return newId;
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to ensure product type ${value}: ${fetchError.message}`);
      throw new Error(`Medusa ensureProductType failed: ${fetchError.message}`);
    }
  }

  async ensureTags(values: string[]): Promise<Array<{ id: string; value: string }>> {
    const results: Array<{ id: string; value: string }> = [];
    for (const value of values) {
      const id = await this.ensureTag(value);
      results.push({ id, value });
    }
    return results;
  }

  async getDefaultSalesChannel(): Promise<string> {
    try {
      // 캐시 확인
      if (this.salesChannelCache.has('Default Sales Channel')) {
        return this.salesChannelCache.get('Default Sales Channel')!;
      }

      const { sales_channels } = await this.sdk.admin.salesChannel.list({
        q: 'Default Sales Channel',
        limit: 1,
      });

      const channel = sales_channels?.[0];
      if (channel) {
        this.salesChannelCache.set('Default Sales Channel', channel.id);
        return channel.id;
      }

      // 없으면 생성 (혹은 에러 처리)
      this.logger.warn('Default Sales Channel not found, creating...');
      const { sales_channel } = await this.sdk.admin.salesChannel.create({
        name: 'Default Sales Channel',
        description: 'Created by Medusa',
      });
      const newId = sales_channel.id;
      this.salesChannelCache.set('Default Sales Channel', newId);
      return newId;
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to get default sales channel: ${fetchError.message}`);
      throw new Error(`Medusa getDefaultSalesChannel failed: ${fetchError.message}`);
    }
  }

  // handle로 medusa product 조회
  async findProductByHandle(handle: string): Promise<MedusaProduct | null> {
    try {
      this.logger.debug(`Finding Medusa product by handle: ${handle}`);

      const { products } = await this.sdk.admin.product.list({
        handle,
        limit: 1,
      });

      if (!products || products.length === 0) {
        this.logger.debug(`No Medusa product found for handle: ${handle}`);
        return null;
      }

      const product = products[0];
      this.logger.debug(`Found Medusa product: ${product.id} (handle: ${product.handle})`);
      return product as MedusaProduct;
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to find product by handle: ${handle}`, fetchError.message);
      throw new Error(`Medusa findProductByHandle failed: ${fetchError.message}`);
    }
  }

  // medusa product 생성
  async createProduct(payload: MedusaProductPayload): Promise<MedusaProduct> {
    try {
      this.logger.log(`Creating Medusa product: ${payload.title} (${payload.handle})`);

      // MedusaProductPayload는 커스텀 타입이므로 SDK 타입으로 변환 필요
      const { product } = await this.sdk.admin.product.create(payload as unknown as HttpTypes.AdminCreateProduct);

      if (!product) {
        throw new Error('Medusa API returned no product in response');
      }

      this.logger.log(`Created Medusa product: ${product.id} (${product.handle})`);
      return product as MedusaProduct;
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to create Medusa product: ${payload.title}`, fetchError.message);
      throw new Error(`Medusa createProduct failed: ${fetchError.message}`);
    }
  }

  // 대용량 variant를 나눠서 생성
  private async createProductChunked(payload: MedusaProductPayload): Promise<MedusaProduct> {
    const variants = payload.variants || [];
    if (variants.length <= this.MAX_VARIANTS_PER_REQUEST) {
      return this.createProduct(payload);
    }

    // 1) 첫 variant만 넣어 product 생성
    const [firstVariant, ...rest] = variants;
    const created = await this.createProduct({
      ...payload,
      variants: [firstVariant],
    });

    try {
      // 2) 나머지 variants는 작은 청크로 추가
      const chunkSize = 10;
      for (let i = 0; i < rest.length; i += chunkSize) {
        const chunk = rest.slice(i, i + chunkSize);
        // MedusaProductPayload의 variants는 커스텀 타입이므로 SDK 타입으로 변환 필요
        await this.addVariants(created.id, chunk as unknown as HttpTypes.AdminCreateProductVariant[]);
      }
    } catch (err) {
      // 부분 생성 방지: 추가 중 실패하면 생성한 상품을 롤백
      this.logger.error(
        `Failed to add variants for product ${created.id}, rolling back create.`,
        err?.response?.data || err?.message,
      );
      await this.safeDeleteProduct(created.id);
      throw err;
    }

    // 3) 최신 product 리턴 (variant id 매핑 위해 조회)
    return this.getProduct(created.id);
  }

  private async addVariants(productId: string, variants: HttpTypes.AdminCreateProductVariant[]): Promise<void> {
    this.logger.debug(`Batch-adding ${variants.length} variants to product ${productId}`);
    await this.sdk.admin.product.batchVariants(productId, {
      create: variants,
    });
  }

  private async getProduct(productId: string): Promise<MedusaProduct> {
    const { product } = await this.sdk.admin.product.retrieve(productId);
    return product as MedusaProduct;
  }

  private async getProductWithVariantDetails(productId: string): Promise<MedusaProduct> {
    const { product } = await this.sdk.admin.product.retrieve(productId, {
      fields:
        'id,*variants,+variants.metadata,+variants.manage_inventory,+variants.sku,+variants.title,+variants.inventory_items',
    });
    return product as MedusaProduct;
  }

  private async enrichPayloadWithExistingVariantIds(
    productId: string,
    payload: MedusaProductPayload,
  ): Promise<MedusaProductPayload> {
    if (!payload.variants || payload.variants.length === 0) {
      return payload;
    }

    const existingProduct = await this.getProductWithVariantDetails(productId);
    const existingVariants = existingProduct.variants || [];

    const pimVariantIdToVariantId = new Map<string, string>();
    const skuToVariantId = new Map<string, string>();
    for (const variant of existingVariants) {
      const pimVariantId = variant.metadata?.pimVariantId;
      if (pimVariantId) {
        pimVariantIdToVariantId.set(pimVariantId, variant.id);
      }
      if (variant.sku) {
        skuToVariantId.set(variant.sku, variant.id);
      }
    }

    const variants = payload.variants.map((variant) => {
      const pimVariantId = variant.metadata?.pimVariantId;
      const matchedId =
        (pimVariantId ? pimVariantIdToVariantId.get(pimVariantId) : undefined) ||
        (variant.sku ? skuToVariantId.get(variant.sku) : undefined);

      return {
        ...variant,
        // 동기화 대상 variant는 임시로 재고 관리 비활성화
        manage_inventory: false,
        ...(matchedId ? { id: matchedId } : {}),
      };
    });

    return {
      ...payload,
      variants,
    };
  }

  private async getOrCreateInventoryItemBySku(sku: string, title: string): Promise<string> {
    const existing = await this.sdk.admin.inventoryItem.list({
      sku,
      limit: 1,
    });
    const existingItemId = existing.inventory_items?.[0]?.id;
    if (existingItemId) {
      return existingItemId;
    }

    try {
      const created = await this.sdk.admin.inventoryItem.create({
        sku,
        title,
      });
      if (!created.inventory_item?.id) {
        throw new Error('Medusa API returned no inventory item id');
      }
      return created.inventory_item.id;
    } catch (error) {
      const fetchError = error as FetchError;
      const isConflict = fetchError.status === 409 || /already exists/i.test(fetchError.message || '');
      if (!isConflict) {
        throw error;
      }

      // 레이스 컨디션으로 생성 충돌 시 재조회 후 재사용
      const retried = await this.sdk.admin.inventoryItem.list({
        sku,
        limit: 1,
      });
      const retriedId = retried.inventory_items?.[0]?.id;
      if (!retriedId) {
        throw error;
      }
      return retriedId;
    }
  }

  private async ensureVariantInventoryLinks(
    productId: string,
    sourceVariants: MedusaProductPayload['variants'],
  ): Promise<void> {
    if (!sourceVariants || sourceVariants.length === 0) {
      return;
    }

    const latest = await this.getProductWithVariantDetails(productId);
    const medusaVariants = latest.variants || [];

    type PayloadVariant = NonNullable<MedusaProductPayload['variants']>[number];
    const sourceByPimVariantId = new Map<string, PayloadVariant>();
    const sourceBySku = new Map<string, PayloadVariant>();

    for (const variant of sourceVariants) {
      const pimVariantId = variant.metadata?.pimVariantId;
      if (pimVariantId) {
        sourceByPimVariantId.set(pimVariantId, variant);
      }
      if (variant.sku) {
        sourceBySku.set(variant.sku, variant);
      }
    }

    const variantsToForceManageInventory = medusaVariants
      .filter((medusaVariant) => {
        const src =
          (medusaVariant.metadata?.pimVariantId
            ? sourceByPimVariantId.get(medusaVariant.metadata.pimVariantId)
            : undefined) || (medusaVariant.sku ? sourceBySku.get(medusaVariant.sku) : undefined);

        if (!src || src.manage_inventory === false) {
          return false;
        }
        return medusaVariant.manage_inventory !== true;
      })
      .map((medusaVariant) => ({
        id: medusaVariant.id,
        manage_inventory: true,
      }));

    if (variantsToForceManageInventory.length > 0) {
      await this.sdk.admin.product.batchVariants(productId, {
        update: variantsToForceManageInventory,
      });
    }

    for (const medusaVariant of medusaVariants) {
      const src =
        (medusaVariant.metadata?.pimVariantId
          ? sourceByPimVariantId.get(medusaVariant.metadata.pimVariantId)
          : undefined) || (medusaVariant.sku ? sourceBySku.get(medusaVariant.sku) : undefined);

      if (!src || src.manage_inventory === false) {
        continue;
      }

      const hasInventoryLink = Array.isArray(medusaVariant.inventory_items) && medusaVariant.inventory_items.length > 0;

      if (hasInventoryLink) {
        continue;
      }

      const pimVariantId = src.metadata?.pimVariantId || medusaVariant.id;
      const sku = medusaVariant.sku || src.sku || `pim-${pimVariantId}`;
      const title = medusaVariant.title || src.title || sku;

      const inventoryItemId = await this.getOrCreateInventoryItemBySku(sku, title);

      try {
        await this.sdk.admin.product.batchVariantInventoryItems(productId, {
          create: [
            {
              inventory_item_id: inventoryItemId,
              variant_id: medusaVariant.id,
              required_quantity: 1,
            },
          ],
        });
        this.logger.log(
          `Linked inventory_item ${inventoryItemId} to variant ${medusaVariant.id} (product ${productId})`,
        );
      } catch (error) {
        const fetchError = error as FetchError;
        const isConflict = fetchError.status === 409 || /already exists/i.test(fetchError.message || '');
        if (isConflict) {
          this.logger.debug(
            `Variant inventory link already exists: variant=${medusaVariant.id}, inventory_item=${inventoryItemId}`,
          );
          continue;
        }
        throw error;
      }
    }
  }

  private async safeDeleteProduct(productId: string): Promise<void> {
    try {
      await this.deleteProduct(productId);
    } catch (e) {
      this.logger.warn(`Failed to rollback product ${productId} after variant add error: ${e?.message}`);
    }
  }

  // medusa product 업데이트
  async updateProduct(medusaProductId: string, payload: Partial<MedusaProductPayload>): Promise<MedusaProduct> {
    try {
      this.logger.log(`Updating Medusa product: ${medusaProductId}`);

      // MedusaProductPayload는 커스텀 타입이므로 SDK 타입으로 변환 필요
      const { product } = await this.sdk.admin.product.update(
        medusaProductId,
        payload as unknown as HttpTypes.AdminUpdateProduct,
      );

      if (!product) {
        throw new Error('Medusa API returned no product in response');
      }

      this.logger.log(`Updated Medusa product: ${product.id} (${product.handle})`);
      return product as MedusaProduct;
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to update Medusa product: ${medusaProductId}`, fetchError.message);
      // Re-throw original error so caller can inspect status/type and decide fallback (create)
      throw error;
    }
  }

  // upsert: medusaProductId가 있으면 update, 없으면 create
  // (mapping repository가 제공한 medusaProductId 사용)
  async upsertProduct(
    payload: MedusaProductPayload,
    medusaProductId?: string,
  ): Promise<{ product: MedusaProduct; action: 'created' | 'updated' }> {
    if (medusaProductId) {
      try {
        // 매핑이 있으면 업데이트
        const updatePayload = await this.enrichPayloadWithExistingVariantIds(medusaProductId, payload);
        const product = await this.updateProduct(medusaProductId, updatePayload);
        await this.ensureVariantInventoryLinks(product.id, payload.variants);
        return { product, action: 'updated' };
      } catch (err) {
        // 이전에 존재하던 product id가 삭제되었을 경우 create로 재시도
        const fetchError = err as FetchError;
        const status = fetchError.status;
        const is404 = status === 404 || /status code 404/i.test(fetchError.message || '');
        if (is404) {
          this.logger.warn(`Medusa product ${medusaProductId} not found. Recreating with handle ${payload.handle}`);
        } else {
          throw err;
        }
      }
    }

    // 매핑이 없으면 handle로 조회 (혹시 매핑 테이블과 실제 상태가 다른 경우 복구)
    const existingProduct = await this.findProductByHandle(payload.handle);
    if (existingProduct) {
      this.logger.warn(
        `Found product by handle without mapping: ${payload.handle} -> ${existingProduct.id}. Updating.`,
      );
      const updatePayload = await this.enrichPayloadWithExistingVariantIds(existingProduct.id, payload);
      const product = await this.updateProduct(existingProduct.id, updatePayload);
      await this.ensureVariantInventoryLinks(product.id, payload.variants);
      return { product, action: 'updated' };
    }

    // 완전히 새 상품
    const product = await this.createProductChunked(payload);
    await this.ensureVariantInventoryLinks(product.id, payload.variants);
    return { product, action: 'created' };
  }

  // medusa product를 draft로 전환 (unpublished 처리 - P1 권장사항)
  async setProductToDraft(medusaProductId: string): Promise<void> {
    try {
      this.logger.log(`Setting Medusa product to draft: ${medusaProductId}`);

      await this.sdk.admin.product.update(medusaProductId, {
        status: 'draft',
      });

      this.logger.log(`Set product to draft: ${medusaProductId}`);
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to set product to draft: ${medusaProductId}`, fetchError.message);
      throw new Error(`Medusa setProductToDraft failed: ${fetchError.message}`);
    }
  }

  // medusa product 삭제 (주의: 장바구니/주문 참조 깨질 수 있음)
  async deleteProduct(medusaProductId: string): Promise<void> {
    try {
      this.logger.warn(`Deleting Medusa product: ${medusaProductId}`);

      await this.sdk.admin.product.delete(medusaProductId);

      this.logger.log(`Deleted Medusa product: ${medusaProductId}`);
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to delete Medusa product: ${medusaProductId}`, fetchError.message);
      throw new Error(`Medusa deleteProduct failed: ${fetchError.message}`);
    }
  }

  // ===== Orders =====

  /**
   * 결제 완료된 Medusa 주문 목록 조회 (증분 처리)
   *
   * - payment_status: 'captured' | 'completed' (결제 완료된 주문만)
   * - updated_at[gt]: since (신규 + 변경 주문 모두 포함하는 증분 처리)
   * - line_items.variant.metadata, line_items.variant.product.metadata 포함
   */
  async listOrders(params: { since?: Date | null; limit?: number }): Promise<MedusaOrder[]> {
    const limit = params.limit ?? 100;
    const allOrders: MedusaOrder[] = [];
    let offset = 0;

    const fields = [
      'id',
      'email',
      'customer_id',
      'currency_code',
      'total',
      'subtotal',
      'shipping_total',
      'discount_total',
      'created_at',
      'updated_at',
      '*items',
      'items.id',
      'items.title',
      'items.quantity',
      'items.unit_price',
      'items.variant_id',
      '+items.variant',
      '+items.variant.metadata',
      '+items.variant.title',
      '+items.variant.product',
      '+items.variant.product.metadata',
      '*shipping_address',
    ].join(',');

    while (true) {
      const query: Record<string, unknown> = {
        limit,
        offset,
        fields,
        payment_status: ['captured', 'completed'],
      };

      if (params.since) {
        query['updated_at'] = { gt: params.since.toISOString() };
      }

      const result = await this.sdk.client.fetch<{ orders: MedusaOrder[]; count: number }>('/admin/orders', {
        method: 'GET',
        query,
      });

      const orders = result?.orders ?? [];
      allOrders.push(...orders);

      if (offset + orders.length >= (result?.count ?? 0) || orders.length < limit) {
        break;
      }

      offset += limit;
    }

    return allOrders;
  }

  // 헬스 체크: medusa api 연결 확인
  async healthCheck(): Promise<boolean> {
    try {
      await this.sdk.admin.product.list({ limit: 1 });
      return true;
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error('Medusa health check failed', fetchError.message);
      return false;
    }
  }

  // ===== Price Lists =====
  private normalizePriceListRules(rules?: Record<string, string[]>): Record<string, string[]> | undefined {
    if (!rules) return undefined;

    // Medusa pricing context key와 동기화
    // legacy key(customer_group_id) → customer.groups.id
    const normalizedRules: Record<string, string[]> = {};

    for (const [key, value] of Object.entries(rules)) {
      const normalizedKey = key === 'customer_group_id' ? 'customer.groups.id' : key;
      normalizedRules[normalizedKey] = value;
    }

    return normalizedRules;
  }

  async ensurePriceList(payload: {
    name: string;
    description: string;
    type: 'sale' | 'override';
    status: 'active' | 'draft';
    rules?: Record<string, string[]>;
  }): Promise<string> {
    try {
      const normalizedRules = this.normalizePriceListRules(payload.rules);

      // 1. 이름으로 기존 Price List 조회
      const { price_lists } = await this.sdk.admin.priceList.list({
        q: payload.name,
        limit: 1,
      });
      const existing = price_lists?.find((pl) => pl.title === payload.name);

      if (existing) {
        // 업데이트 (status/rules)
        const updatePayload: HttpTypes.AdminUpdatePriceList = {
          status: payload.status,
          rules: normalizedRules,
        };

        await this.sdk.admin.priceList.update(existing.id, updatePayload);
        return existing.id;
      }

      // 2. 생성
      const createPayload: HttpTypes.AdminCreatePriceList = {
        title: payload.name,
        description: payload.description,
        type: payload.type,
        status: payload.status,
        prices: [],
        rules: normalizedRules,
      };
      this.logger.debug(`Creating Price List: ${JSON.stringify(createPayload)}`);

      const { price_list } = await this.sdk.admin.priceList.create(createPayload);

      return price_list.id;
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to ensure price list ${payload.name}: ${fetchError.message}`);
      throw new Error(`Medusa ensurePriceList failed: ${fetchError.message}`);
    }
  }

  async addPricesToPriceList(
    priceListId: string,
    prices: Array<{
      amount: number;
      currency_code: string;
      variant_id: string;
      min_quantity?: number;
      max_quantity?: number;
    }>,
  ): Promise<void> {
    try {
      this.logger.debug(`Adding prices to list ${priceListId}`);
      // Medusa v2 Admin API: Custom batch route - use client.fetch
      await this.sdk.client.fetch(`/admin/price-lists/${priceListId}/prices/batch`, {
        method: 'post',
        body: { create: prices },
      });
      this.logger.log(`Added ${prices.length} prices to list ${priceListId}`);
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to add prices to list ${priceListId}: ${fetchError.message}`);
      throw new Error(`Medusa addPricesToPriceList failed: ${fetchError.message}`);
    }
  }

  // ===== Customers & Groups =====
  async findCustomerByEmail(email: string): Promise<HttpTypes.AdminCustomer | null> {
    try {
      const { customers } = await this.sdk.admin.customer.list({
        email,
        limit: 1,
      });
      return customers?.[0] || null;
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.warn(
        `Medusa findCustomerByEmail failed for ${email}: ${fetchError.message} (status=${fetchError.status})`,
      );
      return null;
    }
  }

  async findCustomerByAlmondUserId(almondUserId: string): Promise<HttpTypes.AdminCustomer | null> {
    try {
      const { customer } = await this.sdk.client.fetch<{ customer: HttpTypes.AdminCustomer }>(
        `/admin/customers/by-almond-user/${encodeURIComponent(almondUserId)}`,
        { method: 'GET' },
      );
      return customer ?? null;
    } catch (error) {
      const fetchError = error as FetchError;
      if (fetchError.status === 404) {
        this.logger.log(`findCustomerByAlmondUserId: no customer found for almond_user_id=${almondUserId}`);
        return null;
      }
      this.logger.warn(
        `Medusa findCustomerByAlmondUserId failed (almondUserId=${almondUserId}): ${fetchError.message} (status=${fetchError.status})`,
      );
      return null;
    }
  }

  async addCustomerToGroup(customerId: string, groupId: string): Promise<void> {
    try {
      await this.sdk.admin.customer.batchCustomerGroups(customerId, {
        add: [groupId],
      });
      this.logger.log(`Added customer ${customerId} to group ${groupId}`);
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to add customer ${customerId} to group ${groupId}: ${fetchError.message}`);
      throw new Error(`Medusa addCustomerToGroup failed: ${fetchError.message}`);
    }
  }

  async updateCustomerMetadata(customerId: string, metadata: Record<string, unknown>): Promise<void> {
    try {
      await this.sdk.admin.customer.update(customerId, { metadata });
      this.logger.log(`Updated metadata for customer ${customerId}: ${JSON.stringify(metadata)}`);
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.warn(`Failed to update metadata for customer ${customerId}: ${fetchError.message}`);
      throw error;
    }
  }

  // 고객 metadata에서 특정 key만 제거 (null로 설정하면 Medusa가 해당 key를 삭제함)
  async clearCustomerMetadataKey(customerId: string, key: string): Promise<void> {
    try {
      await this.sdk.admin.customer.update(customerId, { metadata: { [key]: null } });
      this.logger.log(`Cleared metadata key '${key}' for customer ${customerId}`);
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.warn(`Failed to clear metadata key '${key}' for customer ${customerId}: ${fetchError.message}`);
      throw error;
    }
  }

  async removeCustomerFromGroup(customerId: string, groupId: string): Promise<void> {
    try {
      await this.sdk.admin.customer.batchCustomerGroups(customerId, {
        remove: [groupId],
      });
      this.logger.log(`Removed customer ${customerId} from group ${groupId}`);
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.error(`Failed to remove customer ${customerId} from group ${groupId}: ${fetchError.message}`);
      throw new Error(`Medusa removeCustomerFromGroup failed: ${fetchError.message}`);
    }
  }

  /**
   * 카트 가격 재계산 (fire-and-forget).
   * 카트는 아이템 추가 시점 가격이 lock-in되므로, 멤버십 그룹 변경 후 수동 갱신 필요.
   * 반드시 addCustomerToGroup/removeCustomerFromGroup 완료 후 호출할 것.
   */
  async refreshCustomerCartPrices(customerId: string): Promise<void> {
    // sdk.client.fetch()가 커스텀 라우트에 admin 인증 헤더를 제대로 안 넘겨서
    // 네이티브 fetch로 직접 호출
    const encodedKey = Buffer.from(`${this.apiKey}:`).toString('base64');
    const url = `${this.apiUrl}/admin/customers/${customerId}/refresh-cart-prices`;
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${encodedKey}`,
        'Content-Type': 'application/json',
      },
    })
      .then((res) => this.logger.log(`Refreshed cart prices for customer ${customerId} (status=${res.status})`))
      .catch((error) => {
        this.logger.warn(`Failed to refresh cart prices for customer ${customerId}: ${error?.message}`);
      });
  }
}
