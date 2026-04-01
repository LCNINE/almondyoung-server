/**
 * 멤버십 필터링 + 정렬이 적용된 상품 목록 API
 *
 * GET /store/products-sorted
 *
 * Query Parameters:
 * - sort: 정렬 기준 (선택)
 *   - price_asc: 낮은 가격순
 *   - price_desc: 높은 가격순
 *   - sales_desc: 판매량 높은순
 *   - created_at: 최신순
 *   - 미지정 시: 정렬 없이 멤버십 필터링만 적용
 * - limit: 페이지 당 상품 수 (기본: 12)
 * - offset: 시작 위치 (기본: 0)
 * - 기타 필터 파라미터: category_id, collection_id 등 기존 /store/products 파라미터 지원
 *
 * 멤버십 정책:
 * - isMembershipOnly=true: 비멤버에게 상품 자체를 숨김
 * - 롤리킹 지정 상품: 비멤버에게는 상품 노출하되 멤버십가(metadata) 제거
 */
import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PRODUCT_SORT_MODULE } from '../../../modules/product-sort';
import ProductSortModuleService from '../../../modules/product-sort/service';

type SortType = 'price_asc' | 'price_desc' | 'sales_desc' | 'created_at';

type ProductSortKeyData = {
  id: string;
  product_id: string;
  price_sort_key: number | null;
  sales_sort_key: number;
};

type ProductMetadata = {
  isMembershipOnly?: boolean | string;
  [key: string]: unknown;
};

type ProductVariant = {
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type ProductData = {
  id: string;
  created_at: Date;
  metadata?: ProductMetadata | null;
  variants?: ProductVariant[] | null;
  [key: string]: unknown;
};

type StoreProductsResponse = {
  products: ProductData[];
  count: number;
  offset?: number;
  limit?: number;
};

type MemberState = {
  customerId?: string;
  isMember: boolean;
};

const DEFAULT_LIMIT = 12;
const SCAN_BATCH_SIZE = 200;

const VALID_SORT_TYPES = new Set<SortType>(['price_asc', 'price_desc', 'sales_desc', 'created_at']);

// 비멤버에게는 멤버십가 노출을 제한할 상품 (상품 자체는 노출)
const MEMBERSHIP_PRICE_HIDDEN_PRODUCT_IDS = new Set([
  'prod_019c0c0d9b01722ab8ff1ceda3f3501f', // 롤리킹 펌제 1제 2제
  'prod_019c0c0d9b2776fc840b2e730adc6447', // 롤리킹 글루
  'prod_019c0c0d9b2e75ca823ec40282e58b09', // 롤리킹 롯드
  'prod_019c0c0d9b2676c28c79ad749950e351', // 롤리킹 속눈썹펌 세트
  'prod_019c0c0d9b2676c28c7999efcab89e60', // 롤리킹 에센스 5ml
]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const toNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const isMembershipOnlyProduct = (product: ProductData): boolean => {
  return product.metadata?.isMembershipOnly === true || product.metadata?.isMembershipOnly === 'true';
};

const sanitizeMembershipPriceMetadata = (metadata: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...metadata };
  delete next.membershipPrice;
  delete next.membership_price;
  delete next.membershipprice;
  return next;
};

const sanitizeProductForNonMember = (product: ProductData): ProductData => {
  const productId = product.id;

  if (!productId || !MEMBERSHIP_PRICE_HIDDEN_PRODUCT_IDS.has(productId)) {
    return product;
  }

  const variants = Array.isArray(product.variants)
    ? product.variants.map((variant) => {
        if (!variant.metadata || !isRecord(variant.metadata)) {
          return variant;
        }
        return {
          ...variant,
          metadata: sanitizeMembershipPriceMetadata(variant.metadata),
        };
      })
    : product.variants;

  return { ...product, variants };
};

const getRequestOrigin = (req: AuthenticatedMedusaRequest): string => {
  const forwardedProtoHeader = req.headers['x-forwarded-proto'];
  const forwardedProto =
    typeof forwardedProtoHeader === 'string' ? forwardedProtoHeader.split(',')[0]?.trim() : undefined;
  const protocol = forwardedProto || req.protocol || 'http';
  const host = req.headers.host;

  if (!host) {
    throw new Error('host header is missing');
  }

  return `${protocol}://${host}`;
};

const createForwardHeaders = (req: AuthenticatedMedusaRequest): Headers => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers || {})) {
    if (value == null) {
      continue;
    }

    if (typeof value === 'string') {
      headers.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      const valid = value.filter((item): item is string => typeof item === 'string');
      if (valid.length > 0) {
        headers.set(key, valid.join(','));
      }
    }
  }

  headers.delete('host');
  return headers;
};

const appendQueryParam = (searchParams: URLSearchParams, key: string, value: unknown): void => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    searchParams.append(key, String(value));
  }
};

const createBaseSearchParams = (req: AuthenticatedMedusaRequest): URLSearchParams => {
  const searchParams = new URLSearchParams();
  const excludeKeys = new Set(['sort', 'limit', 'offset']);

  for (const [key, value] of Object.entries(req.query || {})) {
    if (value == null || excludeKeys.has(key)) {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => appendQueryParam(searchParams, key, item));
      continue;
    }

    appendQueryParam(searchParams, key, value);
  }

  return searchParams;
};

const parseStoreProductsResponse = (payload: unknown): StoreProductsResponse => {
  if (!isRecord(payload)) {
    return { products: [], count: 0 };
  }

  const rawProducts = payload.products;
  const rawCount = payload.count;
  const rawOffset = payload.offset;
  const rawLimit = payload.limit;

  return {
    products: Array.isArray(rawProducts) ? rawProducts.filter((item): item is ProductData => isRecord(item)) : [],
    count: typeof rawCount === 'number' ? rawCount : 0,
    offset: typeof rawOffset === 'number' ? rawOffset : undefined,
    limit: typeof rawLimit === 'number' ? rawLimit : undefined,
  };
};

const fetchStoreProducts = async (
  req: AuthenticatedMedusaRequest,
  searchParams: URLSearchParams,
): Promise<StoreProductsResponse> => {
  const origin = getRequestOrigin(req);
  const url = new URL('/store/products', origin);
  url.search = searchParams.toString();

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: createForwardHeaders(req),
  });

  if (!response.ok) {
    throw new Error(`상품 조회 실패: ${response.status}`);
  }

  const data: unknown = await response.json();
  return parseStoreProductsResponse(data);
};

const resolveMemberState = async (req: AuthenticatedMedusaRequest): Promise<MemberState> => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim();
  const customerId = req.auth_context?.actor_id;

  if (!customerId || !membershipGroupId) {
    return { customerId, isMember: false };
  }

  try {
    const graphResult: unknown = await query.graph({
      entity: 'customer',
      fields: ['id', 'groups.id'],
      filters: { id: customerId },
    });

    const customers = isRecord(graphResult) ? graphResult.data : undefined;

    if (!Array.isArray(customers)) {
      return { customerId, isMember: false };
    }

    const firstCustomer = (customers as unknown[])[0];
    if (!isRecord(firstCustomer) || !Array.isArray(firstCustomer.groups)) {
      return { customerId, isMember: false };
    }

    const isMember = firstCustomer.groups.some((group) => {
      return isRecord(group) && group.id === membershipGroupId;
    });

    return { customerId, isMember };
  } catch (error) {
    console.error('[products-sorted] 멤버십 확인 실패:', error);
    return { customerId, isMember: false };
  }
};

const applyMembershipFilter = (products: ProductData[], isMember: boolean): ProductData[] => {
  if (isMember) {
    return products;
  }

  return products
    .filter((product) => !isMembershipOnlyProduct(product))
    .map((product) => sanitizeProductForNonMember(product));
};

const sortProducts = (
  products: ProductData[],
  sortKeysMap: Map<string, ProductSortKeyData>,
  sortType: SortType,
): ProductData[] => {
  return [...products].sort((a, b) => {
    const keyA = sortKeysMap.get(a.id);
    const keyB = sortKeysMap.get(b.id);

    switch (sortType) {
      case 'price_asc': {
        const priceA = keyA?.price_sort_key ?? null;
        const priceB = keyB?.price_sort_key ?? null;

        if (priceA === null && priceB === null) return 0;
        if (priceA === null) return 1;
        if (priceB === null) return -1;
        return priceA - priceB;
      }

      case 'price_desc': {
        const priceA = keyA?.price_sort_key ?? null;
        const priceB = keyB?.price_sort_key ?? null;

        if (priceA === null && priceB === null) return 0;
        if (priceA === null) return 1;
        if (priceB === null) return -1;
        return priceB - priceA;
      }

      case 'sales_desc': {
        const salesA = keyA?.sales_sort_key ?? 0;
        const salesB = keyB?.sales_sort_key ?? 0;
        return salesB - salesA;
      }

      case 'created_at':
      default: {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateB - dateA;
      }
    }
  });
};

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const sortParam = req.query.sort as string | undefined;
  const hasSort = sortParam && VALID_SORT_TYPES.has(sortParam as SortType);
  const sortType: SortType | null = hasSort ? (sortParam as SortType) : null;
  const requestedLimit = toNumber(req.query.limit, DEFAULT_LIMIT);
  const requestedOffset = toNumber(req.query.offset, 0);

  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const productSortModule = req.scope.resolve<ProductSortModuleService>(PRODUCT_SORT_MODULE);

  logger.info(`[products-sorted] sort=${sortType}, limit=${requestedLimit}, offset=${requestedOffset}`);

  try {
    const { customerId, isMember } = await resolveMemberState(req);
    logger.info(`[products-sorted] customerId=${customerId}, isMember=${isMember}`);

    const baseSearchParams = createBaseSearchParams(req);

    // 정렬 없이 멤버십 필터링만 (기존 membership-products 동작)
    if (!sortType) {
      if (isMember) {
        baseSearchParams.set('limit', String(requestedLimit));
        baseSearchParams.set('offset', String(requestedOffset));

        const response = await fetchStoreProducts(req, baseSearchParams);

        return res.json({
          products: response.products,
          count: response.count,
          offset: requestedOffset,
          limit: requestedLimit,
        });
      }

      // 비멤버: 전체 스캔 후 필터링
      const scanParams = new URLSearchParams(baseSearchParams);
      scanParams.set('limit', String(SCAN_BATCH_SIZE));
      scanParams.set('offset', '0');

      const pagedProducts: ProductData[] = [];
      let visibleTotal = 0;
      let seenVisible = 0;
      let rawOffset = 0;
      let rawCount = Number.POSITIVE_INFINITY;

      while (rawOffset < rawCount) {
        scanParams.set('offset', String(rawOffset));
        const batchResponse = await fetchStoreProducts(req, scanParams);
        rawCount = batchResponse.count;

        if (batchResponse.products.length === 0) break;

        const visibleBatch = applyMembershipFilter(batchResponse.products, isMember);

        for (const product of visibleBatch) {
          if (seenVisible >= requestedOffset && pagedProducts.length < requestedLimit) {
            pagedProducts.push(product);
          }
          seenVisible += 1;
        }

        visibleTotal += visibleBatch.length;
        rawOffset += batchResponse.products.length;
      }

      return res.json({
        products: pagedProducts,
        count: visibleTotal,
        offset: requestedOffset,
        limit: requestedLimit,
      });
    }

    // 정렬 있음: 전체 스캔 → 멤버십 필터링 → 정렬 → 페이징
    const scanParams = new URLSearchParams(baseSearchParams);
    scanParams.set('limit', String(SCAN_BATCH_SIZE));
    scanParams.set('offset', '0');

    const allProducts: ProductData[] = [];
    let rawOffset = 0;
    let rawCount = Number.POSITIVE_INFINITY;

    while (rawOffset < rawCount) {
      scanParams.set('offset', String(rawOffset));
      const batchResponse = await fetchStoreProducts(req, scanParams);
      rawCount = batchResponse.count;

      if (batchResponse.products.length === 0) break;

      allProducts.push(...batchResponse.products);
      rawOffset += batchResponse.products.length;
    }

    // 멤버십 필터링 적용
    const filteredProducts = applyMembershipFilter(allProducts, isMember);

    // 정렬 키 조회
    const productIds = filteredProducts.map((p) => p.id);
    const sortKeys =
      productIds.length > 0
        ? await productSortModule.listProductSortKeys({ product_id: productIds })
        : [];

    const sortKeysMap = new Map<string, ProductSortKeyData>();
    for (const key of sortKeys) {
      sortKeysMap.set(key.product_id, {
        id: key.id,
        product_id: key.product_id,
        price_sort_key: key.price_sort_key != null ? Number(key.price_sort_key) : null,
        sales_sort_key: Number(key.sales_sort_key) || 0,
      });
    }

    // 정렬 및 페이징
    const sortedProducts = sortProducts(filteredProducts, sortKeysMap, sortType);
    const pagedProducts = sortedProducts.slice(requestedOffset, requestedOffset + requestedLimit);

    return res.json({
      products: pagedProducts,
      count: filteredProducts.length,
      offset: requestedOffset,
      limit: requestedLimit,
    });
  } catch (error) {
    logger.error('[products-sorted] 상품 조회 실패:', error);

    return res.status(500).json({
      products: [],
      count: 0,
      offset: requestedOffset,
      limit: requestedLimit,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
