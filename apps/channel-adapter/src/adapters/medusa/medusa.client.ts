import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Medusa from '@medusajs/js-sdk';
import type { FetchError } from '@medusajs/js-sdk';
import type { HttpTypes } from '@medusajs/types';
import { createMedusaSdk } from './medusa-sdk.config';
import type { MedusaProductPayload, MedusaProduct } from '../../types';
import type { PimCategoryDetail } from './pim.client';
import {
  isMedusaProductSellableInventoryItem,
  shouldManageMedusaInventoryForSellableProjection,
  toMedusaProductSellableInventorySku,
} from '@packages/domain-types';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts';
import { LIFECYCLE_PAYMENT_STATUSES, PAYMENT_ACCEPTED_STATUSES } from './medusa-order-status';

export interface MedusaOrder {
  id: string;
  status?: 'pending' | 'completed' | 'draft' | 'archived' | 'canceled' | 'requires_action';
  payment_status?:
    | 'not_paid'
    | 'awaiting'
    | 'authorized'
    | 'partially_authorized'
    | 'captured'
    | 'partially_captured'
    | 'partially_refunded'
    | 'refunded'
    | 'requires_action'
    | 'canceled';
  email?: string;
  customer_id?: string;
  // customer.metadata.almond_user_id = 내부 user-service 사용자 UUID (가입 시 stamp). cus_ id 는 core 로 내보내지 않는다.
  customer?: {
    id?: string;
    metadata?: Record<string, unknown> | null;
  };
  currency_code?: string;
  total?: number;
  subtotal?: number;
  shipping_total?: number;
  discount_total?: number;
  created_at?: string;
  updated_at?: string;
  canceled_at?: string;
  // 주문 레벨 메타데이터. 무통장입금 선생성 주문의 bank_transfer_status('awaiting_deposit'|'confirmed')로 입금 전(미수집) 여부를 판별하는 데 사용
  metadata?: Record<string, unknown> | null;
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
  payment_collections?: Array<{
    id?: string;
    payments?: Array<{
      id?: string;
      data?: Record<string, unknown>;
      captures?: Array<{ id?: string }>;
      refunds?: Array<{
        id?: string;
        amount?: number | string;
        created_at?: string;
      }>;
    }>;
  }>;
  transactions?: Array<{
    id?: string;
    amount?: number | string;
    currency_code?: string;
    reference?: string;
    reference_id?: string;
    created_at?: string;
  }>;
  summary?: {
    refunded_total?: number | string;
  };
}

function isPaymentAcceptedOrder(order: MedusaOrder): boolean {
  return PAYMENT_ACCEPTED_STATUSES.has(order.payment_status);
}

function isLifecycleOrder(order: MedusaOrder): boolean {
  if (order.status === 'canceled' || LIFECYCLE_PAYMENT_STATUSES.has(order.payment_status)) {
    return true;
  }
  if (Number(order.summary?.refunded_total ?? 0) > 0) {
    return true;
  }
  if (order.transactions?.some((transaction) => transaction.reference === 'refund' || Number(transaction.amount) < 0)) {
    return true;
  }
  return (
    order.payment_collections?.some((collection) =>
      collection.payments?.some((payment) => (payment.refunds?.length ?? 0) > 0),
    ) ?? false
  );
}

function isCollectableOrder(order: MedusaOrder): boolean {
  return isPaymentAcceptedOrder(order) || isLifecycleOrder(order);
}

const ORDER_FIELDS = [
  'id',
  'status',
  'payment_status',
  'email',
  'customer_id',
  'customer.id',
  '+customer.metadata',
  'currency_code',
  'total',
  'subtotal',
  'shipping_total',
  'discount_total',
  'created_at',
  'updated_at',
  'canceled_at',
  'metadata',
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
  'payment_collections.id',
  'payment_collections.payments.id',
  'payment_collections.payments.data',
  'payment_collections.payments.captures.id',
  'payment_collections.payments.refunds.id',
  'payment_collections.payments.refunds.amount',
  'payment_collections.payments.refunds.created_at',
  'summary.refunded_total',
  'transactions.id',
  'transactions.amount',
  'transactions.currency_code',
  'transactions.reference',
  'transactions.reference_id',
  'transactions.created_at',
].join(',');

@Injectable()
export class MedusaClient {
  private readonly logger = new Logger(MedusaClient.name);
  private readonly sdk: Medusa;
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly categoryCache = new Map<string, MedusaProduct['id']>(); // key: handle
  // categoryCache 의 value(=Medusa category id) 만 모은 set. attachProductToCategories 에서
  // "이 id 가 이미 알려진 것인가" 를 O(1) 으로 검사하기 위해 유지한다 (values() 선형 스캔 회피).
  private readonly knownCategoryIds = new Set<string>();
  private readonly tagCache = new Map<string, string>(); // key: value
  private readonly typeCache = new Map<string, string>(); // key: value
  private readonly salesChannelCache = new Map<string, string>(); // key: name
  private defaultShippingProfileId?: string;
  private projectionStockLocationId?: string;
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
    this.knownCategoryIds.clear();
    this.tagCache.clear();
    this.typeCache.clear();
    this.salesChannelCache.clear();
    this.defaultShippingProfileId = undefined;
    this.logger.log('All caches cleared');
  }

  private setCategoryCache(key: string, medusaCategoryId: string): void {
    this.categoryCache.set(key, medusaCategoryId);
    this.knownCategoryIds.add(medusaCategoryId);
  }

  // 백필 시작 시 1회 호출하여 카테고리 전체를 categoryCache 에 적재한다.
  // 이후 ensureCategoryFromSnapshot 가 list/verify/update 없이 cache hit 으로 즉답 가능.
  // key: handle, metadata.pimCategoryId, metadata.pimSlug 모두 같은 medusaId 로 매핑.
  async primeCategoryCache(): Promise<number> {
    let total = 0;
    const limit = 100;
    let offset = 0;
    while (true) {
      const { product_categories } = await this.sdk.admin.productCategory.list({ limit, offset });
      if (!product_categories?.length) break;
      for (const c of product_categories) {
        if (!c.id) continue;
        if (c.handle) this.setCategoryCache(c.handle, c.id);
        const meta = (c.metadata as any) || {};
        if (meta.pimCategoryId) this.setCategoryCache(meta.pimCategoryId, c.id);
        if (meta.pimSlug) this.setCategoryCache(meta.pimSlug, c.id);
        total += 1;
      }
      if (product_categories.length < limit) break;
      offset += limit;
    }
    this.logger.log(`Category cache primed: ${total} categories`);
    return total;
  }

  // 백필 시작 시 1회 호출하여 태그 전체를 tagCache 에 적재한다.
  async primeTagCache(): Promise<number> {
    let total = 0;
    const limit = 100;
    let offset = 0;
    while (true) {
      const { product_tags } = await this.sdk.admin.productTag.list({ limit, offset });
      if (!product_tags?.length) break;
      for (const t of product_tags) {
        if (t.value && t.id) {
          this.tagCache.set(t.value, t.id);
          total += 1;
        }
      }
      if (product_tags.length < limit) break;
      offset += limit;
    }
    this.logger.log(`Tag cache primed: ${total} tags`);
    return total;
  }

  // 백필 시작 시 1회 호출하여 product type 전체를 typeCache 에 적재한다.
  async primeProductTypeCache(): Promise<number> {
    let total = 0;
    const limit = 100;
    let offset = 0;
    while (true) {
      const { product_types } = await this.sdk.admin.productType.list({ limit, offset });
      if (!product_types?.length) break;
      for (const t of product_types) {
        if (t.value && t.id) {
          this.typeCache.set(t.value, t.id);
          total += 1;
        }
      }
      if (product_types.length < limit) break;
      offset += limit;
    }
    this.logger.log(`ProductType cache primed: ${total} types`);
    return total;
  }

  // sales channel 은 보통 소수이므로 1 페이지면 충분.
  async primeSalesChannelCache(): Promise<number> {
    const { sales_channels } = await this.sdk.admin.salesChannel.list({ limit: 100 });
    let total = 0;
    for (const ch of sales_channels || []) {
      if (ch.name && ch.id) {
        this.salesChannelCache.set(ch.name, ch.id);
        total += 1;
      }
    }
    this.logger.log(`SalesChannel cache primed: ${total} channels`);
    return total;
  }

  // 백필 진입점에서 호출. category/tag/productType/salesChannel 캐시를 한꺼번에 채워
  // 상품 1건당 list/verify HTTP 호출을 0 회에 가깝게 줄인다.
  async primeAll(): Promise<{ categories: number; tags: number; types: number; channels: number }> {
    const [categories, tags, types, channels] = await Promise.all([
      this.primeCategoryCache(),
      this.primeTagCache(),
      this.primeProductTypeCache(),
      this.primeSalesChannelCache(),
    ]);
    return { categories, tags, types, channels };
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

  // metadata 필터를 SDK 가 지원하지 않으므로 admin/product-category list 를 페이지네이션하며
  // 인메모리 매칭한다. 카테고리가 수백 개 단위로 늘어나도 동작하도록 limit 단위로 끝까지 훑는다.
  // cacheOnly=true 면 LIST 호출을 스킵하고 즉시 null. primeCategoryCache 후 백필에서만 활성화 추천.
  private async findCategoryByPimId(
    pimCategoryId: string,
    options?: { cacheOnly?: boolean },
  ): Promise<HttpTypes.AdminProductCategory | null> {
    if (options?.cacheOnly) return null;
    try {
      const limit = 100;
      let offset = 0;
      // count 가 응답에 없을 수 있어 빈 페이지를 종료 신호로 사용.
      while (true) {
        const { product_categories } = await this.sdk.admin.productCategory.list({ limit, offset });
        if (!product_categories?.length) return null;
        const found = product_categories.find((c) => (c.metadata as any)?.pimCategoryId === pimCategoryId);
        if (found) return found;
        if (product_categories.length < limit) return null;
        offset += limit;
      }
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.warn(`Medusa findCategoryByPimId failed for ${pimCategoryId}: ${fetchError.message}`);
      return null;
    }
  }

  // PIM 카테고리 ID로 Medusa 카테고리를 역참조.
  // (1) 같은 프로세스에서 이미 만든 항목은 categoryCache 에 pimCategoryId 키로 들어가 있어 즉답
  // (2) 캐시 미스 시 metadata.pimCategoryId 페이지네이션 검색
  // (3) 마지막 fallback 으로 handle = pimCategoryId 매칭(legacy 트리 경로 호환).
  // cacheOnly=true 면 (2)/(3) 모두 스킵 — primeCategoryCache 가 보장된 환경에서만 사용.
  async findCategoryByPimRef(
    pimCategoryId: string,
    options?: { cacheOnly?: boolean },
  ): Promise<HttpTypes.AdminProductCategory | null> {
    const cachedId = this.categoryCache.get(pimCategoryId);
    if (cachedId) {
      return { id: cachedId } as HttpTypes.AdminProductCategory;
    }
    if (options?.cacheOnly) return null;
    const byMetadata = await this.findCategoryByPimId(pimCategoryId);
    if (byMetadata?.id) {
      this.setCategoryCache(pimCategoryId, byMetadata.id);
      return byMetadata;
    }
    const byHandle = await this.findCategoryByHandle(pimCategoryId);
    if (byHandle?.id) {
      this.setCategoryCache(pimCategoryId, byHandle.id);
    }
    return byHandle;
  }

  // 백필 진입 시 primeAll 후 호출. cacheOnly mode 를 켜서 ensureCategoryFromSnapshot 의
  // paginated LIST 우회 — 캐시에 없는 항목은 신규 create 경로로 분기되어 정상 동작.
  private cacheOnlyMode = false;
  enableCacheOnlyCategoryLookup(enable: boolean): void {
    this.cacheOnlyMode = enable;
    this.logger.log(`Category cacheOnly mode: ${enable ? 'ON' : 'OFF'}`);
  }

  async softDeleteCategory(medusaCategoryId: string): Promise<void> {
    await this.sdk.admin.productCategory.update(medusaCategoryId, { is_active: false });
  }

  invalidateCategoryCacheByHandle(handle: string): void {
    const id = this.categoryCache.get(handle);
    this.categoryCache.delete(handle);
    // 해당 medusaId 를 가리키는 다른 키가 남아있지 않은 경우에만 knownCategoryIds 에서 제거.
    if (id) {
      let stillReferenced = false;
      for (const v of this.categoryCache.values()) {
        if (v === id) {
          stillReferenced = true;
          break;
        }
      }
      if (!stillReferenced) this.knownCategoryIds.delete(id);
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
        this.setCategoryCache(handle, existing.id);
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
    this.setCategoryCache(handle, created.id);
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
    // [백필 시 주석 해제] 대량 백필 중에는 아래 캐시 fast-path를 활성화해
    // 카테고리당 list/verify/update API 호출을 0회에 가깝게 줄일 수 있다.
    // 단, 실시간 이벤트(CategoryChanged) 경로에서는 캐시 히트가 실제 업데이트를 막으므로
    // 백필이 끝나면 반드시 다시 주석 처리할 것.
    // const cachedById = this.categoryCache.get(categorySnapshot.id);
    // if (cachedById) return cachedById;
    // const cachedBySlug = categorySnapshot.slug ? this.categoryCache.get(categorySnapshot.slug) : undefined;
    // if (cachedBySlug) {
    //   this.setCategoryCache(categorySnapshot.id, cachedBySlug);
    //   return cachedBySlug;
    // }

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

    let parentMedusaId: string | undefined;

    if (categorySnapshot.parentId) {
      // 부모는 자식과 같은 식별자 규약(handle=slug||id, metadata.pimCategoryId)을 따라 저장된다.
      // 자식이 들고 있는 parentId 는 PIM UUID 라서 handle 매칭만으로는 슬러그가 있는 부모를
      // 못 찾는다. metadata 매칭까지 시도하는 findCategoryByPimRef 를 사용한다.
      const existingParent = await this.findCategoryByPimRef(categorySnapshot.parentId, {
        cacheOnly: this.cacheOnlyMode,
      });
      if (existingParent?.id) {
        parentMedusaId = existingParent.id;
      } else {
        this.logger.warn(`Parent category ${categorySnapshot.parentId} not found in Medusa, creating without parent`);
      }
    }

    // cacheOnly 모드면 paginated LIST 를 시도하지 않는다 — 캐시 미스는 신규로 처리.
    const existing = this.cacheOnlyMode
      ? null
      : (await this.findCategoryByCandidateHandles(preferredHandle, legacyHandle)) ||
        (await this.findCategoryByPimId(categorySnapshot.id));
    if (existing?.id) {
      const verified = await this.getCategoryById(existing.id);
      if (!verified) {
        // getCategoryById 실패 시 handle 조회 결과를 신뢰 (네트워크 오류일 수 있음)
        this.logger.warn(`Category ${existing.id} found by handle but getCategoryById failed. Using handle result.`);
        this.setCategoryCache(preferredHandle, existing.id);
        this.setCategoryCache(categorySnapshot.id, existing.id);
        return existing.id;
      }

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
      try {
        await this.sdk.admin.productCategory.update(existing.id, updatePayload);
      } catch (err) {
        const fetchError = err as FetchError;
        this.logger.warn(
          `Failed to update Medusa category ${existing.id} from snapshot ${categorySnapshot.id}: ${fetchError.message}`,
        );
      }
      this.setCategoryCache(preferredHandle, existing.id);
      this.setCategoryCache(categorySnapshot.id, existing.id);
      this.logger.debug(`Ensured existing Medusa category ${existing.id} for PIM ${categorySnapshot.id}`);
      return existing.id;
    }

    const payload = {
      name: categorySnapshot.name,
      handle: preferredHandle,
      is_internal: false,
      is_active: isActive,
      parent_category_id: parentMedusaId,
      ...(categorySnapshot.thumbnail && { thumbnail: categorySnapshot.thumbnail }),
      ...(categorySnapshot.sortOrder != null && { rank: categorySnapshot.sortOrder }),
      metadata: {
        ...pimMetadata,
      },
    };

    const created = await this.createCategory(payload);
    this.setCategoryCache(preferredHandle, created.id);
    this.setCategoryCache(categorySnapshot.id, created.id);
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

    // 카테고리 존재 여부 확인. knownCategoryIds 에 있으면 getCategoryById 도 생략.
    // primeCategoryCache 후엔 거의 모든 id 가 캐시 hit 이라 verify 라운드트립이 사라진다.
    for (const catId of unique) {
      const ok = this.knownCategoryIds.has(catId) || !!(await this.getCategoryById(catId));
      if (!ok) {
        this.logger.warn(`Category ${catId} does not exist in Medusa before attaching product ${productId}`);
        if (options?.throwOnFailure) {
          throw new Error(`Category ${catId} not found`);
        }
        return;
      }
    }

    // productCategory.updateProducts로 M:N 조인 테이블에 직접 추가.
    // (product.update({ categories }) 는 product record만 업데이트하고 조인 테이블을 갱신하지 않음)
    for (const catId of unique) {
      try {
        await this.sdk.admin.productCategory.updateProducts(catId, { add: [productId] } as any);
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
    // 캐시 hit 분리 — 미스 항목만 순차 ensure (primeTagCache 후엔 대부분 hit).
    const hits: Array<{ id: string; value: string }> = [];
    const misses: string[] = [];
    for (const value of values) {
      const cached = this.tagCache.get(value);
      if (cached) {
        hits.push({ id: cached, value });
      } else {
        misses.push(value);
      }
    }
    if (misses.length === 0) return hits;
    const ensured: Array<{ id: string; value: string }> = [];
    for (const value of misses) {
      ensured.push({ value, id: await this.ensureTag(value) });
    }
    return [...hits, ...ensured];
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

  async getDefaultShippingProfileId(): Promise<string> {
    if (this.defaultShippingProfileId) {
      return this.defaultShippingProfileId;
    }

    const { shipping_profiles } = await this.sdk.admin.shippingProfile.list({ type: 'default', limit: 10 });
    const profile = shipping_profiles?.[0];
    if (!profile?.id) {
      throw new Error('Default Medusa shipping profile not found. Run seed-shipping first.');
    }

    this.defaultShippingProfileId = profile.id;
    return profile.id;
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
    let latest = await this.createProduct({
      ...payload,
      variants: [firstVariant],
    });

    try {
      // 2) 나머지 variants는 작은 청크로 추가. batchVariants 응답에 최신 product 가 포함되면
      //    그것을 누적해서 마지막 getProduct 재조회를 회피한다.
      const chunkSize = 10;
      for (let i = 0; i < rest.length; i += chunkSize) {
        const chunk = rest.slice(i, i + chunkSize);
        const updated = await this.addVariants(latest.id, chunk as unknown as HttpTypes.AdminCreateProductVariant[]);
        if (updated) latest = updated;
      }
    } catch (err) {
      // 부분 생성 방지: 추가 중 실패하면 생성한 상품을 롤백
      this.logger.error(
        `Failed to add variants for product ${latest.id}, rolling back create.`,
        err?.response?.data || err?.message,
      );
      await this.safeDeleteProduct(latest.id);
      throw err;
    }

    // 3) batchVariants 응답이 product 를 포함하지 않거나 variant 가 누락된 경우에만 재조회.
    const expectedVariantCount = variants.length;
    if (!latest.variants || latest.variants.length < expectedVariantCount) {
      this.logger.debug(
        `batchVariants response missing variants (${latest.variants?.length ?? 0}/${expectedVariantCount}); falling back to getProduct`,
      );
      return this.getProduct(latest.id);
    }
    return latest;
  }

  private async addVariants(
    productId: string,
    variants: HttpTypes.AdminCreateProductVariant[],
  ): Promise<MedusaProduct | undefined> {
    this.logger.debug(`Batch-adding ${variants.length} variants to product ${productId}`);
    const response = await this.sdk.admin.product.batchVariants(productId, {
      create: variants,
    });
    // SDK 응답 형식이 버전마다 다를 수 있어 product 가 있을 때만 반환.
    const product = (response as unknown as { product?: MedusaProduct }).product;
    return product;
  }

  private async getProduct(productId: string): Promise<MedusaProduct> {
    const { product } = await this.sdk.admin.product.retrieve(productId);
    return product as MedusaProduct;
  }

  private async getProductWithVariantDetails(productId: string): Promise<MedusaProduct> {
    const { product } = await this.sdk.admin.product.retrieve(productId, {
      fields:
        'id,*variants,+variants.metadata,+variants.manage_inventory,+variants.sku,+variants.title,' +
        '+variants.inventory_items,+variants.inventory_items.inventory.id,+variants.inventory_items.inventory.sku,' +
        '+variants.inventory_items.inventory.metadata',
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

    type PayloadVariant = NonNullable<MedusaProductPayload['variants']>[number];
    type ExistingVariant = NonNullable<MedusaProduct['variants']>[number];
    const pimVariantIdToVariant = new Map<string, ExistingVariant>();
    const skuToVariant = new Map<string, ExistingVariant>();
    for (const variant of existingVariants) {
      const pimVariantId = variant.metadata?.pimVariantId;
      if (pimVariantId) {
        pimVariantIdToVariant.set(pimVariantId, variant);
      }
      if (variant.sku) {
        skuToVariant.set(variant.sku, variant);
      }
    }

    const variants = payload.variants.map((variant) => {
      const pimVariantId = variant.metadata?.pimVariantId;
      const matchedVariant =
        (pimVariantId ? pimVariantIdToVariant.get(pimVariantId) : undefined) ||
        (variant.sku ? skuToVariant.get(variant.sku) : undefined);

      if (!matchedVariant) {
        return variant;
      }

      const enriched: PayloadVariant = {
        ...variant,
        id: matchedVariant.id,
      };
      if (typeof matchedVariant.manage_inventory === 'boolean') {
        enriched.manage_inventory = matchedVariant.manage_inventory;
      }

      return enriched;
    });

    return {
      ...payload,
      variants,
    };
  }

  private async getOrCreateSellableProjectionInventoryItem(params: {
    pimVariantId: string;
    title: string;
  }): Promise<string> {
    const sku = toMedusaProductSellableInventorySku(params.pimVariantId);
    const existing = await this.sdk.admin.inventoryItem.list({
      sku,
      limit: 1,
      fields: 'id,sku,metadata',
    });
    const existingItemId = existing.inventory_items?.[0]?.id;
    if (existingItemId) {
      return existingItemId;
    }

    try {
      const created = await this.sdk.admin.inventoryItem.create({
        sku,
        title: params.title,
        requires_shipping: true,
        metadata: {
          projectionType: 'product_sellable_quantity',
          projectionSource: 'core',
          pimVariantId: params.pimVariantId,
        },
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

  // PIM variant ↔ Medusa-local Product Sellable Quantity inventory item link 보장.
  // inventory_item 은 Core SKU 정체성이 아니라 Medusa checkout projection 저장소다.
  private async ensureVariantInventoryLinks(
    productId: string,
    sourceVariants: MedusaProductPayload['variants'],
    latestProduct?: MedusaProduct,
    options: { requiresShipping?: boolean } = {},
  ): Promise<Map<string, { variantId: string; inventoryItemId: string }>> {
    const ensured = new Map<string, { variantId: string; inventoryItemId: string }>();
    if (!sourceVariants || sourceVariants.length === 0) {
      return ensured;
    }

    if (options.requiresShipping === false) {
      await this.removeProjectionInventoryLinks(productId, latestProduct);
      return ensured;
    }

    // inventory_items 까지 포함된 product 가 필요. 없으면 한 번 fetch.
    const hasInventoryFields =
      latestProduct &&
      Array.isArray(latestProduct.variants) &&
      latestProduct.variants.length > 0 &&
      // inventory_items 가 1 개라도 응답에 포함되었으면 fields 가 채워졌다고 판단.
      latestProduct.variants.some((v: any) => 'inventory_items' in v);
    const latest = hasInventoryFields ? latestProduct! : await this.getProductWithVariantDetails(productId);
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

    const matchSrc = (medusaVariant: any): PayloadVariant | undefined =>
      (medusaVariant.metadata?.pimVariantId
        ? sourceByPimVariantId.get(medusaVariant.metadata.pimVariantId)
        : undefined) || (medusaVariant.sku ? sourceBySku.get(medusaVariant.sku) : undefined);

    type LinkTarget = {
      variantId: string;
      pimVariantId: string;
      title: string;
      projectionInventoryItemId?: string;
      staleInventoryItemIds: string[];
    };
    const linkTargets: LinkTarget[] = [];

    for (const medusaVariant of medusaVariants) {
      const src = matchSrc(medusaVariant);
      const pimVariantId = src?.metadata?.pimVariantId || medusaVariant.metadata?.pimVariantId;
      if (!src || !pimVariantId) continue;

      const inventoryLinks = Array.isArray((medusaVariant as any).inventory_items)
        ? ((medusaVariant as any).inventory_items as any[])
        : [];
      const projectionSku = toMedusaProductSellableInventorySku(pimVariantId);
      const projectionLink = inventoryLinks.find((link) => {
        const inventory = link.inventory as
          | { sku?: string | null; metadata?: Record<string, unknown> | null }
          | undefined;
        return (
          link.inventory_item_id &&
          (inventory?.sku === projectionSku ||
            ((inventory?.metadata as Record<string, unknown> | null | undefined)?.pimVariantId === pimVariantId &&
              isMedusaProductSellableInventoryItem(inventory)))
        );
      });
      const staleInventoryItemIds = inventoryLinks
        .filter((link) => link.inventory_item_id && link.inventory_item_id !== projectionLink?.inventory_item_id)
        .map((link) => link.inventory_item_id as string);

      linkTargets.push({
        variantId: medusaVariant.id,
        pimVariantId,
        title: medusaVariant.title || src.title || projectionSku,
        projectionInventoryItemId: projectionLink?.inventory_item_id,
        staleInventoryItemIds,
      });
    }

    if (linkTargets.length === 0) return ensured;

    const createPayload: Array<{ inventory_item_id: string; variant_id: string; required_quantity: number }> = [];
    const updatePayload: Array<{ inventory_item_id: string; variant_id: string; required_quantity: number }> = [];
    const deletePayload: Array<{ inventory_item_id: string; variant_id: string }> = [];

    for (const target of linkTargets) {
      const inventoryItemId =
        target.projectionInventoryItemId ??
        (await this.getOrCreateSellableProjectionInventoryItem({
          pimVariantId: target.pimVariantId,
          title: target.title,
        }));

      ensured.set(target.pimVariantId, { variantId: target.variantId, inventoryItemId });

      if (!target.projectionInventoryItemId) {
        createPayload.push({
          inventory_item_id: inventoryItemId,
          variant_id: target.variantId,
          required_quantity: 1,
        });
      } else {
        const link = (medusaVariants.find((variant) => variant.id === target.variantId) as any)?.inventory_items?.find(
          (item: any) => item.inventory_item_id === inventoryItemId,
        );
        if (link?.required_quantity !== undefined && link.required_quantity !== 1) {
          updatePayload.push({
            inventory_item_id: inventoryItemId,
            variant_id: target.variantId,
            required_quantity: 1,
          });
        }
      }

      for (const staleInventoryItemId of target.staleInventoryItemIds) {
        deletePayload.push({
          inventory_item_id: staleInventoryItemId,
          variant_id: target.variantId,
        });
      }
    }

    if (createPayload.length === 0 && updatePayload.length === 0 && deletePayload.length === 0) {
      return ensured;
    }

    try {
      await this.sdk.admin.product.batchVariantInventoryItems(productId, {
        create: createPayload,
        update: updatePayload,
        delete: deletePayload,
      });
      this.logger.log(
        `Ensured ${ensured.size} sellable projection inventory links for product ${productId} ` +
          `(created=${createPayload.length}, updated=${updatePayload.length}, removed=${deletePayload.length})`,
      );
    } catch (error) {
      const fetchError = error as FetchError;
      const isConflict = fetchError.status === 409 || /already exists/i.test(fetchError.message || '');
      if (!isConflict) throw error;

      this.logger.warn(
        `batchVariantInventoryItems hit conflict; retrying per-variant for ${createPayload.length} entries`,
      );
      for (const entry of createPayload) {
        try {
          await this.sdk.admin.product.batchVariantInventoryItems(productId, { create: [entry] });
        } catch (perItemError) {
          const perItemFetch = perItemError as FetchError;
          const perItemConflict = perItemFetch.status === 409 || /already exists/i.test(perItemFetch.message || '');
          if (perItemConflict) {
            this.logger.debug(
              `Variant inventory link already exists: variant=${entry.variant_id}, inventory_item=${entry.inventory_item_id}`,
            );
            continue;
          }
          throw perItemError;
        }
      }
      if (deletePayload.length > 0) {
        await this.sdk.admin.product.batchVariantInventoryItems(productId, { delete: deletePayload });
      }
      if (updatePayload.length > 0) {
        await this.sdk.admin.product.batchVariantInventoryItems(productId, { update: updatePayload });
      }
    }

    return ensured;
  }

  private async removeProjectionInventoryLinks(productId: string, latestProduct?: MedusaProduct): Promise<void> {
    const latest = latestProduct ?? (await this.getProductWithVariantDetails(productId));
    const deletePayload: Array<{ inventory_item_id: string; variant_id: string }> = [];

    for (const variant of latest.variants || []) {
      for (const link of ((variant as any).inventory_items || []) as any[]) {
        const inventory = link.inventory as
          | { sku?: string | null; metadata?: Record<string, unknown> | null }
          | undefined;
        if (link.inventory_item_id && inventory && isMedusaProductSellableInventoryItem(inventory)) {
          deletePayload.push({
            inventory_item_id: link.inventory_item_id,
            variant_id: variant.id,
          });
        }
      }
    }

    if (deletePayload.length > 0) {
      await this.sdk.admin.product.batchVariantInventoryItems(productId, { delete: deletePayload });
      this.logger.log(
        `Removed ${deletePayload.length} sellable projection inventory links for non-shipping product ${productId}`,
      );
    }
  }

  private async getProjectionStockLocationId(): Promise<string> {
    if (this.projectionStockLocationId) {
      return this.projectionStockLocationId;
    }

    const defaultSalesChannelId = await this.getDefaultSalesChannel();
    const configuredId = this.configService.get<string>('MEDUSA_INVENTORY_PROJECTION_STOCK_LOCATION_ID');
    if (configuredId) {
      const { stock_location: configuredLocation } = await this.sdk.admin.stockLocation.retrieve(configuredId, {
        fields: 'id,name,*sales_channels',
      });
      if (!configuredLocation?.id) {
        throw new Error(`Configured Medusa stock location not found: ${configuredId}`);
      }
      await this.ensureStockLocationSalesChannelLink(configuredLocation, defaultSalesChannelId);
      this.projectionStockLocationId = configuredId;
      return configuredId;
    }

    const preferredName =
      this.configService.get<string>('MEDUSA_INVENTORY_PROJECTION_STOCK_LOCATION_NAME') || '한국 물류창고';

    const { stock_locations: stockLocations } = await this.sdk.admin.stockLocation.list({
      limit: 100,
      fields: 'id,name,*sales_channels',
    } as any);

    let stockLocation =
      stockLocations?.find((location) =>
        location.sales_channels?.some((channel) => channel.id === defaultSalesChannelId),
      ) ??
      stockLocations?.find((location) => location.name === preferredName) ??
      stockLocations?.[0];

    if (!stockLocation) {
      const created = await this.sdk.admin.stockLocation.create(
        {
          name: preferredName,
          address: { country_code: 'kr', address_1: '' },
        } as any,
        { fields: 'id,name,*sales_channels' },
      );
      stockLocation = created.stock_location;
    }

    await this.ensureStockLocationSalesChannelLink(stockLocation, defaultSalesChannelId);

    this.projectionStockLocationId = stockLocation.id;
    return stockLocation.id;
  }

  private async ensureStockLocationSalesChannelLink(
    stockLocation: { id: string; sales_channels?: Array<{ id?: string | null }> },
    defaultSalesChannelId: string,
  ): Promise<void> {
    const linkedToDefaultSalesChannel = stockLocation.sales_channels?.some(
      (channel) => channel.id === defaultSalesChannelId,
    );
    if (!linkedToDefaultSalesChannel) {
      await this.sdk.admin.stockLocation.updateSalesChannels(stockLocation.id, {
        add: [defaultSalesChannelId],
      });
    }
  }

  // 반환값: 이 호출 직전의 stocked_quantity (레벨이 없었으면 null). 품절 전환 판별에 사용.
  private async upsertProjectionInventoryLevel(
    inventoryItemId: string,
    stockedQuantity: number,
  ): Promise<number | null> {
    const locationId = await this.getProjectionStockLocationId();
    const { inventory_levels: levels } = await this.sdk.admin.inventoryItem.listLevels(inventoryItemId, {
      location_id: locationId,
      limit: 1,
    } as any);

    const previousQuantity = typeof levels?.[0]?.stocked_quantity === 'number' ? levels[0].stocked_quantity : null;
    const normalizedQuantity = Math.max(0, Math.trunc(stockedQuantity || 0));
    if (levels?.[0]) {
      await this.sdk.admin.inventoryItem.updateLevel(inventoryItemId, locationId, {
        stocked_quantity: normalizedQuantity,
      });
      return previousQuantity;
    }

    await this.sdk.admin.inventoryItem.batchInventoryItemLocationLevels(inventoryItemId, {
      create: [{ location_id: locationId, stocked_quantity: normalizedQuantity }],
      update: [],
      delete: [],
    });
    return previousQuantity;
  }

  async applyProductSellableQuantityProjection(
    input: ProductSellableQuantityChangedPayload & {
      medusaProductId: string;
    },
  ): Promise<{ soldOutChanged: boolean }> {
    const product = await this.getProductWithVariantDetails(input.medusaProductId);
    const medusaVariant = product.variants?.find((variant) => variant.metadata?.pimVariantId === input.variantId);

    if (!medusaVariant) {
      throw new Error(
        `Medusa variant with pimVariantId=${input.variantId} not found on product ${input.medusaProductId}`,
      );
    }

    const ensuredLinks = await this.ensureVariantInventoryLinks(
      product.id,
      [
        {
          id: medusaVariant.id,
          title: medusaVariant.title,
          sku: medusaVariant.sku,
          metadata: { pimVariantId: input.variantId },
        },
      ],
      product,
    );
    const ensuredLink = ensuredLinks.get(input.variantId);
    if (!ensuredLink) {
      throw new Error(`Failed to ensure sellable projection inventory link for pimVariantId=${input.variantId}`);
    }

    const shouldManageInventory = shouldManageMedusaInventoryForSellableProjection(input);
    const previousBackorder = (medusaVariant as { allow_backorder?: boolean }).allow_backorder ?? false;
    // 수동품절은 선판매(백오더)를 이긴다 — 강제 품절이 의도이므로 allow_backorder 를 끈다.
    // 그 외엔 선판매 정책(preStockSellable)을 그대로 반영해 해제 시 복원되게 한다.
    const desiredBackorder =
      input.availabilityOverride === 'manual_out_of_stock' ? false : !!input.preStockSellable;
    const newStock = shouldManageInventory ? Math.max(0, Math.trunc(input.sellableQuantity || 0)) : 0;

    const variantUpdate: { id: string; manage_inventory?: boolean; allow_backorder?: boolean } = {
      id: medusaVariant.id,
    };
    if (medusaVariant.manage_inventory !== shouldManageInventory) {
      variantUpdate.manage_inventory = shouldManageInventory;
    }
    if (previousBackorder !== desiredBackorder) {
      variantUpdate.allow_backorder = desiredBackorder;
    }
    if (Object.keys(variantUpdate).length > 1) {
      await this.sdk.admin.product.batchVariants(product.id, { update: [variantUpdate] });
    }

    const previousStock = await this.upsertProjectionInventoryLevel(
      ensuredLink.inventoryItemId,
      shouldManageInventory ? input.sellableQuantity : 0,
    );

    // 스토어프론트 품절 표시 기준: manage_inventory && stock<=0 && !allow_backorder.
    // 이 변경이 "판매중↔품절" 상태를 바꿨는지 계산 — 캐시 무효화는 이 전환 때만 한다
    const oldSoldOut = !!medusaVariant.manage_inventory && (previousStock ?? 0) <= 0 && !previousBackorder;
    const newSoldOut = shouldManageInventory && newStock <= 0 && !desiredBackorder;
    const soldOutChanged = oldSoldOut !== newSoldOut;

    this.logger.log(
      `Applied Product Sellable Quantity projection: pimVariantId=${input.variantId}, ` +
        `medusaVariant=${medusaVariant.id}, manage_inventory=${shouldManageInventory}, ` +
        `stocked_quantity=${newStock}, reason=${input.reason ?? 'unknown'}, soldOutChanged=${soldOutChanged}`,
    );

    return { soldOutChanged };
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
    const requiresShipping = payload.metadata.requiresShipping !== false;

    if (medusaProductId) {
      try {
        // 매핑이 있으면 업데이트
        const updatePayload = await this.enrichPayloadWithExistingVariantIds(medusaProductId, payload);
        const product = await this.updateProduct(medusaProductId, updatePayload);
        await this.ensureVariantInventoryLinks(product.id, payload.variants, undefined, { requiresShipping });
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
      await this.ensureVariantInventoryLinks(product.id, payload.variants, undefined, { requiresShipping });
      return { product, action: 'updated' };
    }

    // 완전히 새 상품. createProductChunked 가 반환하는 product 는 일반 retrieve 결과라
    // inventory_items 필드가 없을 가능성이 높음 → ensureVariantInventoryLinks 가 필요시
    // getProductWithVariantDetails 로 다시 조회한다 (기존 동작 유지).
    const product = await this.createProductChunked(payload);
    await this.ensureVariantInventoryLinks(product.id, payload.variants, undefined, { requiresShipping });
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
   * - payment_status 기반으로 Payment Accepted 상태(authorized/captured)만 클라이언트 필터링
   * - updated_at[gt]: since (신규 + 변경 주문 모두 포함하는 증분 처리)
   * - line_items.variant.metadata, line_items.variant.product.metadata 포함
   */
  async listOrders(params: { since?: Date | null; limit?: number }): Promise<MedusaOrder[]> {
    const limit = params.limit ?? 100;
    const allOrders: MedusaOrder[] = [];
    let offset = 0;

    while (true) {
      const query: Record<string, unknown> = {
        limit,
        offset,
        fields: ORDER_FIELDS,
      };

      if (params.since) {
        query['updated_at'] = { gt: params.since.toISOString() };
      }

      const result = await this.sdk.client.fetch<{ orders: MedusaOrder[]; count: number }>('/admin/orders', {
        method: 'GET',
        query,
      });

      const orders = result?.orders ?? [];
      allOrders.push(...orders.filter(isCollectableOrder));

      if (offset + orders.length >= (result?.count ?? 0) || orders.length < limit) {
        break;
      }

      offset += limit;
    }

    return allOrders;
  }

  async retrieveOrder(orderId: string): Promise<MedusaOrder | null> {
    try {
      const result = await this.sdk.client.fetch<{ order?: MedusaOrder }>(
        `/admin/orders/${encodeURIComponent(orderId)}`,
        {
          method: 'GET',
          query: { fields: ORDER_FIELDS },
        },
      );

      const order = result?.order;
      if (!order || !isCollectableOrder(order)) {
        return null;
      }
      return order;
    } catch (error) {
      const fetchError = error as FetchError;
      if (fetchError.status === 404) {
        return null;
      }
      this.logger.error(`Failed to retrieve Medusa order: ${orderId}`, fetchError.message);
      throw new Error(`Medusa retrieveOrder failed: ${fetchError.message}`);
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.sdk.client.fetch(`/admin/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
      });
      this.logger.log(`Cancelled Medusa order: ${orderId}`);
    } catch (error) {
      const fetchError = error as FetchError;
      // 400: already cancelled / invalid state transition — treat as success (idempotent)
      // 404: order not found (maybe quarantined order that never reached Medusa)
      if (fetchError.status === 400 || fetchError.status === 404) {
        this.logger.warn(
          `Medusa cancelOrder skipped (status=${fetchError.status}): ${orderId} - ${fetchError.message}`,
        );
        return;
      }
      this.logger.error(`Failed to cancel Medusa order: ${orderId}`, fetchError.message);
      throw new Error(`Medusa cancelOrder failed: ${fetchError.message}`);
    }
  }

  /**
   * Core WMS 출고/배송 완료 이벤트를 Medusa order metadata에 반영 (projection only).
   *
   * Medusa를 배송 SSOT로 만들지 않는다. order.metadata에 Core WMS 기준 배송 상태를
   * 기록하여 storefront가 Core actions API와 함께 참조할 수 있게 한다.
   * PG/provider를 다시 호출하지 않고 metadata 업데이트만 수행한다.
   * 멱등성: 같은 status로 재전달돼도 같은 metadata 값으로 덮어쓰므로 안전하다.
   */
  async updateOrderShippingProjection(
    orderId: string,
    data: {
      status: 'shipped' | 'delivered';
      fulfillmentId: string;
      carrier?: string;
      trackingNumber?: string;
      shippedAt?: string;
      deliveredAt?: string;
    },
  ): Promise<void> {
    try {
      // 기존 metadata를 GET으로 읽어 병합 — metadata 필드를 통째로 교체하지 않기 위해
      const existing = await this.sdk.client.fetch<{ order: { metadata?: Record<string, unknown> } }>(
        `/admin/orders/${encodeURIComponent(orderId)}`,
        { method: 'GET' },
      );
      const existingMeta = (existing?.order?.metadata as Record<string, unknown>) ?? {};

      const metadata: Record<string, unknown> = {
        ...existingMeta,
        coreShippingStatus: data.status,
        coreFulfillmentId: data.fulfillmentId,
      };
      if (data.carrier) metadata.coreCarrier = data.carrier;
      if (data.trackingNumber) metadata.coreTrackingNumber = data.trackingNumber;
      if (data.shippedAt) metadata.coreShippedAt = data.shippedAt;
      if (data.deliveredAt) metadata.coreDeliveredAt = data.deliveredAt;

      await this.sdk.client.fetch(`/admin/orders/${encodeURIComponent(orderId)}`, {
        method: 'POST',
        body: { metadata } as Record<string, unknown>,
      });

      this.logger.log(`Updated Medusa order shipping projection: orderId=${orderId}, status=${data.status}`);
    } catch (error) {
      const fetchError = error as FetchError;
      if (fetchError.status === 404) {
        this.logger.warn(`Medusa updateOrderShippingProjection: order not found, skipping orderId=${orderId}`);
        return;
      }
      this.logger.error(`Failed to update Medusa order shipping projection: ${orderId}`, fetchError.message);
      throw new Error(`Medusa updateOrderShippingProjection failed: ${fetchError.message}`);
    }
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
      if (fetchError.status === 404) return null;
      this.logger.warn(
        `Medusa findCustomerByEmail failed for ${email}: ${fetchError.message} (status=${fetchError.status})`,
      );
      throw error;
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
      throw error;
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

  async issuePromotionsByTrigger(
    customerId: string,
    trigger: 'customer_registered' | 'membership_activated' | 'birthday',
  ): Promise<{ issued: number; skipped: number }> {
    try {
      const result = await this.sdk.client.fetch<{ issued: any[]; skipped: any[] }>(
        `/admin/customers/${customerId}/issue-coupons`,
        { method: 'POST', body: { trigger } },
      );
      const issued = result?.issued?.length ?? 0;
      const skipped = result?.skipped?.length ?? 0;
      if (issued > 0) {
        this.logger.log(`Auto-issued ${issued} coupon(s) to customer ${customerId} via trigger=${trigger}`);
      }
      return { issued, skipped };
    } catch (error) {
      const fetchError = error as FetchError;
      this.logger.warn(
        `issuePromotionsByTrigger failed (customerId=${customerId}, trigger=${trigger}): ${fetchError.message}`,
      );
      throw new Error(`Medusa issuePromotionsByTrigger failed: ${fetchError.message}`);
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
