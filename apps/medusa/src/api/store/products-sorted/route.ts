import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import type { RemoteQueryFunction } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { PRODUCT_SORT_MODULE } from '../../../modules/product-sort';
import type { ProductSortModuleService } from '../../../modules/product-sort/service';

type SortOption = 'price_asc' | 'price_desc' | 'sales_desc' | 'created_at';

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 100;

/**
 * GET /store/products-sorted
 *
 * Query params:
 * - sort: price_asc | price_desc | sales_desc | created_at
 * - limit: number (default 12, max 100)
 * - offset: number (default 0)
 * - category_id: string | string[]
 * - collection_id: string | string[]
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sort = parseSortOption(req.query.sort);
  const limit = parseNumber(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const offset = parseNumber(req.query.offset, 0);
  const categoryIds = parseStringArray(req.query.category_id);
  const collectionIds = parseStringArray(req.query.collection_id);

  const query = req.scope.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.QUERY);
  const productSortService = req.scope.resolve<ProductSortModuleService>(PRODUCT_SORT_MODULE);

  const hasFilter = categoryIds.length > 0 || collectionIds.length > 0;

  let productIds: string[];
  let totalCount: number;

  if (hasFilter) {
    // 필터 있음: product + product_sort_key JOIN 후 메모리 정렬
    const result = await fetchFilteredProducts(query, categoryIds, collectionIds, sort);
    productIds = result.ids;
    totalCount = result.total;
  } else {
    // 필터 없음: product_sort_key 테이블에서 DB 정렬
    const result = await fetchSortedProductIds(productSortService, sort);
    productIds = result.ids;
    totalCount = result.total;
  }

  // 페이지네이션
  const paginatedIds = productIds.slice(offset, offset + limit);

  if (paginatedIds.length === 0) {
    return res.json({ products: [], count: totalCount, offset, limit });
  }

  // 상품 상세 조회
  const products = await fetchProductDetails(query, paginatedIds);

  return res.json({
    products,
    count: totalCount,
    offset,
    limit,
  });
};

// ============ Helper Functions ============

function parseSortOption(value: unknown): SortOption {
  if (typeof value !== 'string') return 'created_at';
  const v = value.toLowerCase();
  if (v === 'price_asc' || v === 'price_desc' || v === 'sales_desc' || v === 'created_at') {
    return v;
  }
  return 'created_at';
}

function parseNumber(value: unknown, fallback: number, max?: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return max ? Math.min(num, max) : num;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return [value];
  return [];
}

/**
 * 필터 없음: product_sort_key 테이블에서 정렬된 product_id 목록 조회
 */
async function fetchSortedProductIds(
  service: ProductSortModuleService,
  sort: SortOption,
): Promise<{ ids: string[]; total: number }> {
  const order = buildOrderConfig(sort);
  const sortKeys = await service.listProductSortKeys({}, { order });

  const ids = sortKeys.map((sk) => sk.product_id);
  return { ids, total: ids.length };
}

function buildOrderConfig(sort: SortOption): Record<string, 'ASC' | 'DESC'> {
  switch (sort) {
    case 'price_asc':
      return { price_sort_key: 'ASC' };
    case 'price_desc':
      return { price_sort_key: 'DESC' };
    case 'sales_desc':
      return { sales_sort_key: 'DESC' };
    default:
      return { created_at: 'DESC' };
  }
}

/**
 * 필터 있음: product + product_sort_key 조회 후 메모리 정렬
 */
async function fetchFilteredProducts(
  query: RemoteQueryFunction,
  categoryIds: string[],
  collectionIds: string[],
  sort: SortOption,
): Promise<{ ids: string[]; total: number }> {
  const filters: Record<string, unknown> = {};
  if (categoryIds.length > 0) filters.categories = { id: categoryIds };
  if (collectionIds.length > 0) filters.collection_id = collectionIds;

  const { data } = await query.graph({
    entity: 'product',
    fields: ['id', 'created_at', 'product_sort_key.price_sort_key', 'product_sort_key.sales_sort_key'],
    filters,
  });

  type ProductWithSortKey = {
    id: string;
    created_at?: string | Date;
    product_sort_key?: { price_sort_key?: number | null; sales_sort_key?: number | null };
  };

  const products = data as ProductWithSortKey[];
  const sorted = sortInMemory(products, sort);

  return { ids: sorted.map((p) => p.id), total: sorted.length };
}

function sortInMemory<T extends { id: string; created_at?: string | Date; product_sort_key?: { price_sort_key?: number | null; sales_sort_key?: number | null } }>(
  products: T[],
  sort: SortOption,
): T[] {
  return [...products].sort((a, b) => {
    switch (sort) {
      case 'price_asc': {
        const aVal = a.product_sort_key?.price_sort_key ?? Number.MAX_SAFE_INTEGER;
        const bVal = b.product_sort_key?.price_sort_key ?? Number.MAX_SAFE_INTEGER;
        return Number(aVal) - Number(bVal);
      }
      case 'price_desc': {
        const aVal = a.product_sort_key?.price_sort_key ?? 0;
        const bVal = b.product_sort_key?.price_sort_key ?? 0;
        return Number(bVal) - Number(aVal);
      }
      case 'sales_desc': {
        const aVal = a.product_sort_key?.sales_sort_key ?? 0;
        const bVal = b.product_sort_key?.sales_sort_key ?? 0;
        return Number(bVal) - Number(aVal);
      }
      default: {
        // created_at DESC
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bDate - aDate;
      }
    }
  });
}

/**
 * 상품 상세 조회 (정렬 순서 유지)
 */
async function fetchProductDetails(query: RemoteQueryFunction, productIds: string[]): Promise<unknown[]> {
  const { data } = await query.graph({
    entity: 'product',
    fields: [
      'id',
      'title',
      'handle',
      'subtitle',
      'description',
      'thumbnail',
      'status',
      'metadata',
      'created_at',
      'updated_at',
      'variants.*',
      'variants.prices.*',
      'images.*',
      'options.*',
      'options.values.*',
      'tags.*',
      'type.*',
      'collection.*',
      'categories.*',
    ],
    filters: { id: productIds },
  });

  // 정렬 순서 유지
  const productMap = new Map<string, unknown>();
  for (const p of data as { id: string }[]) {
    productMap.set(p.id, p);
  }

  return productIds.map((id) => productMap.get(id)).filter(Boolean);
}
