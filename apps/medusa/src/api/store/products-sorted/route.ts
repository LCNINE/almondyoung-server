import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PRODUCT_SORT_MODULE } from '../../../modules/product-sort';
import type { ProductSortModuleService } from '../../../modules/product-sort/service';
import {
  MembershipProduct,
  isMembershipOnlyProduct,
  isRecord,
  resolveMemberState,
  sanitizeProductForNonMember,
} from '../../../utils/membership-filter';

type SortOption = 'price_asc' | 'price_desc' | 'sales_desc' | 'created_at';

type StoreProductsResponse = {
  products: MembershipProduct[];
  count: number;
  offset?: number;
  limit?: number;
};

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 100;

const toNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const parseSortOption = (value: unknown): SortOption => {
  if (typeof value !== 'string') return 'created_at';
  const lower = value.toLowerCase();
  if (lower === 'price_asc' || lower === 'price_desc' || lower === 'sales_desc' || lower === 'created_at') {
    return lower;
  }
  return 'created_at';
};

const getRequestOrigin = (req: AuthenticatedMedusaRequest) => {
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

const createForwardHeaders = (req: AuthenticatedMedusaRequest) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers || {})) {
    if (value == null) continue;

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

const parseStoreProductsResponse = (payload: unknown): StoreProductsResponse => {
  if (!isRecord(payload)) {
    return { products: [], count: 0 };
  }

  const rawProducts = payload.products;
  const rawCount = payload.count;
  const rawOffset = payload.offset;
  const rawLimit = payload.limit;

  return {
    products: Array.isArray(rawProducts) ? rawProducts.filter((item): item is MembershipProduct => isRecord(item)) : [],
    count: typeof rawCount === 'number' ? rawCount : 0,
    offset: typeof rawOffset === 'number' ? rawOffset : undefined,
    limit: typeof rawLimit === 'number' ? rawLimit : undefined,
  };
};

const fetchProductsByIds = async (
  req: AuthenticatedMedusaRequest,
  productIds: string[],
  extraParams: Record<string, string>,
): Promise<Map<string, MembershipProduct>> => {
  if (productIds.length === 0) {
    return new Map();
  }

  const origin = getRequestOrigin(req);
  const searchParams = new URLSearchParams();

  productIds.forEach((id) => searchParams.append('id', id));

  for (const [key, value] of Object.entries(extraParams)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  searchParams.set('limit', String(productIds.length));
  searchParams.set('offset', '0');

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
  const parsed = parseStoreProductsResponse(data);

  const productMap = new Map<string, MembershipProduct>();
  for (const product of parsed.products) {
    if (product.id) {
      productMap.set(product.id, product);
    }
  }

  return productMap;
};

const buildSortKeyOrder = (sort: SortOption): { field: string; direction: 'ASC' | 'DESC' } | null => {
  switch (sort) {
    case 'price_asc':
      return { field: 'price_sort_key', direction: 'ASC' };
    case 'price_desc':
      return { field: 'price_sort_key', direction: 'DESC' };
    case 'sales_desc':
      return { field: 'sales_sort_key', direction: 'DESC' };
    case 'created_at':
      return null;
    default:
      return null;
  }
};

/**
 * GET /store/products-sorted
 *
 * 정렬된 상품 목록 API
 *
 * Query Parameters:
 *  - sort: price_asc | price_desc | sales_desc | created_at (default: created_at)
 *  - limit: number (default: 12, max: 100)
 *  - offset: number (default: 0)
 *  - category_id: string[]
 *  - collection_id: string[]
 *  - region_id: string (required for price calculation)
 *  - fields: string (comma-separated, passed to /store/products)
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const requestedLimit = Math.min(toNumber(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  const requestedOffset = toNumber(req.query.offset, 0);
  const sort = parseSortOption(req.query.sort);

  const regionId = typeof req.query.region_id === 'string' ? req.query.region_id : undefined;
  const categoryIds = Array.isArray(req.query.category_id)
    ? req.query.category_id.filter((v): v is string => typeof v === 'string')
    : typeof req.query.category_id === 'string'
      ? [req.query.category_id]
      : [];
  const collectionIds = Array.isArray(req.query.collection_id)
    ? req.query.collection_id.filter((v): v is string => typeof v === 'string')
    : typeof req.query.collection_id === 'string'
      ? [req.query.collection_id]
      : [];
  const fields = typeof req.query.fields === 'string' ? req.query.fields : undefined;

  try {
    const { isMember } = await resolveMemberState(req);
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const sortKeyOrder = buildSortKeyOrder(sort);

    let sortedProductIds: string[] = [];
    let totalCount = 0;

    if (sortKeyOrder) {
      const productSortService = req.scope.resolve(PRODUCT_SORT_MODULE) as ProductSortModuleService;

      const orderConfig: Record<string, 'ASC' | 'DESC'> = {
        [sortKeyOrder.field]: sortKeyOrder.direction,
      };

      const allSortKeys = await productSortService.listProductSortKeys({}, { order: orderConfig });

      const allProductIds = allSortKeys.map((sk) => sk.product_id);

      if (!isMember) {
        const membershipOnlyFilter = async (productIds: string[]): Promise<string[]> => {
          if (productIds.length === 0) return [];

          const { data: products } = await query.graph({
            entity: 'product',
            fields: ['id', 'metadata'],
            filters: { id: productIds },
          });

          const visibleProducts = (products as MembershipProduct[]).filter((p) => !isMembershipOnlyProduct(p));
          const visibleIdSet = new Set(visibleProducts.map((p) => p.id));

          return productIds.filter((id) => visibleIdSet.has(id));
        };

        const filteredIds = await membershipOnlyFilter(allProductIds);
        totalCount = filteredIds.length;
        sortedProductIds = filteredIds.slice(requestedOffset, requestedOffset + requestedLimit);
      } else {
        totalCount = allProductIds.length;
        sortedProductIds = allProductIds.slice(requestedOffset, requestedOffset + requestedLimit);
      }
    } else {
      const extraParams: Record<string, string> = {};
      if (regionId) extraParams.region_id = regionId;
      if (fields) extraParams.fields = fields;
      categoryIds.forEach((id, i) => (extraParams[`category_id[${i}]`] = id));
      collectionIds.forEach((id, i) => (extraParams[`collection_id[${i}]`] = id));

      const origin = getRequestOrigin(req);
      const searchParams = new URLSearchParams();

      searchParams.set('order', '-created_at');
      searchParams.set('limit', String(requestedLimit));
      searchParams.set('offset', String(requestedOffset));

      for (const [key, value] of Object.entries(extraParams)) {
        searchParams.set(key, value);
      }

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
      const parsed = parseStoreProductsResponse(data);

      let filteredProducts = parsed.products;

      if (!isMember) {
        filteredProducts = parsed.products
          .filter((p) => !isMembershipOnlyProduct(p))
          .map((p) => sanitizeProductForNonMember(p));
      }

      return res.json({
        products: filteredProducts,
        count: parsed.count,
        offset: requestedOffset,
        limit: requestedLimit,
      });
    }

    const extraParams: Record<string, string> = {};
    if (regionId) extraParams.region_id = regionId;
    if (fields) extraParams.fields = fields;

    const productMap = await fetchProductsByIds(req, sortedProductIds, extraParams);

    const orderedProducts: MembershipProduct[] = [];
    for (const productId of sortedProductIds) {
      const product = productMap.get(productId);
      if (product) {
        if (!isMember) {
          orderedProducts.push(sanitizeProductForNonMember(product));
        } else {
          orderedProducts.push(product);
        }
      }
    }

    return res.json({
      products: orderedProducts,
      count: totalCount,
      offset: requestedOffset,
      limit: requestedLimit,
    });
  } catch (error) {
    console.error('[products-sorted] 상품 조회 실패:', error);

    return res.status(500).json({
      products: [],
      count: 0,
      offset: requestedOffset,
      limit: requestedLimit,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
