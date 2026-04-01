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
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
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
  id: string;
  metadata?: Record<string, unknown> | null;
  calculated_price?: {
    calculated_amount?: number | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

type ProductData = {
  id: string;
  created_at: Date;
  metadata?: ProductMetadata | null;
  variants?: ProductVariant[] | null;
  [key: string]: unknown;
};

type MemberState = {
  customerId?: string;
  isMember: boolean;
};

type QueryFilters = {
  id?: string[];
  categories?: { id: string[] };
  collection_id?: string[];
  status?: string;
};

const DEFAULT_LIMIT = 12;

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

const toStringArray = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
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

const buildQueryFilters = (req: AuthenticatedMedusaRequest): QueryFilters => {
  const filters: QueryFilters = {
    status: 'published',
  };

  const categoryIds = toStringArray(req.query.category_id);
  if (categoryIds.length > 0) {
    filters.categories = { id: categoryIds };
  }

  const collectionIds = toStringArray(req.query.collection_id);
  if (collectionIds.length > 0) {
    filters.collection_id = collectionIds;
  }

  const productIds = toStringArray(req.query.id);
  if (productIds.length > 0) {
    filters.id = productIds;
  }

  return filters;
};

const fetchProductsViaQuery = async (
  req: AuthenticatedMedusaRequest,
  filters: QueryFilters,
  limit: number,
  offset: number,
): Promise<{ products: ProductData[]; count: number }> => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const regionId = req.query.region_id as string | undefined;

  const fields = [
    'id',
    'title',
    'handle',
    'subtitle',
    'description',
    'status',
    'thumbnail',
    'created_at',
    'updated_at',
    'metadata',
    'tags.*',
    'images.*',
    'variants.*',
    'variants.prices.*',
    'variants.images.*',
    'variants.options.*',
    'categories.*',
    'collection.*',
  ];

  const graphResult: unknown = await query.graph({
    entity: 'product',
    fields,
    filters,
    pagination: {
      skip: offset,
      take: limit,
      order: { created_at: 'DESC' },
    },
  });

  const data = isRecord(graphResult) ? graphResult.data : [];
  const products = Array.isArray(data) ? (data as ProductData[]) : [];

  // count 조회 (별도 쿼리)
  const countResult: unknown = await query.graph({
    entity: 'product',
    fields: ['id'],
    filters,
  });
  const countData = isRecord(countResult) ? countResult.data : [];
  const count = Array.isArray(countData) ? countData.length : 0;

  // calculated_price 계산 (region_id가 있는 경우)
  if (regionId && products.length > 0) {
    const pricingModule = req.scope.resolve(Modules.PRICING);
    const variantIds = products.flatMap((p) => p.variants?.map((v) => v.id) ?? []).filter(Boolean);

    if (variantIds.length > 0) {
      try {
        const calculatedPrices = await pricingModule.calculatePrices(
          { id: variantIds },
          { context: { region_id: regionId } },
        );

        const priceMap = new Map<string, { calculated_amount: number | null }>();
        for (const price of calculatedPrices) {
          if (price.id) {
            const amount = price.calculated_amount != null ? Number(price.calculated_amount) : null;
            priceMap.set(price.id, { calculated_amount: amount });
          }
        }

        for (const product of products) {
          if (product.variants) {
            for (const variant of product.variants) {
              const calcPrice = priceMap.get(variant.id);
              if (calcPrice) {
                variant.calculated_price = calcPrice;
              }
            }
          }
        }
      } catch (error) {
        console.error('[products-sorted] 가격 계산 실패:', error);
      }
    }
  }

  return { products, count };
};

const fetchAllProductsViaQuery = async (
  req: AuthenticatedMedusaRequest,
  filters: QueryFilters,
): Promise<ProductData[]> => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const regionId = req.query.region_id as string | undefined;

  const fields = [
    'id',
    'title',
    'handle',
    'subtitle',
    'description',
    'status',
    'thumbnail',
    'created_at',
    'updated_at',
    'metadata',
    'tags.*',
    'images.*',
    'variants.*',
    'variants.prices.*',
    'variants.images.*',
    'variants.options.*',
    'categories.*',
    'collection.*',
  ];

  const graphResult: unknown = await query.graph({
    entity: 'product',
    fields,
    filters,
  });

  const data = isRecord(graphResult) ? graphResult.data : [];
  const products = Array.isArray(data) ? (data as ProductData[]) : [];

  // calculated_price 계산 (region_id가 있는 경우)
  if (regionId && products.length > 0) {
    const pricingModule = req.scope.resolve(Modules.PRICING);
    const variantIds = products.flatMap((p) => p.variants?.map((v) => v.id) ?? []).filter(Boolean);

    if (variantIds.length > 0) {
      try {
        const calculatedPrices = await pricingModule.calculatePrices(
          { id: variantIds },
          { context: { region_id: regionId } },
        );

        const priceMap = new Map<string, { calculated_amount: number | null }>();
        for (const price of calculatedPrices) {
          if (price.id) {
            const amount = price.calculated_amount != null ? Number(price.calculated_amount) : null;
            priceMap.set(price.id, { calculated_amount: amount });
          }
        }

        for (const product of products) {
          if (product.variants) {
            for (const variant of product.variants) {
              const calcPrice = priceMap.get(variant.id);
              if (calcPrice) {
                variant.calculated_price = calcPrice;
              }
            }
          }
        }
      } catch (error) {
        console.error('[products-sorted] 가격 계산 실패:', error);
      }
    }
  }

  return products;
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

    const filters = buildQueryFilters(req);

    // 정렬 없이 멤버십 필터링만 (기존 membership-products 동작)
    if (!sortType) {
      if (isMember) {
        const { products, count } = await fetchProductsViaQuery(req, filters, requestedLimit, requestedOffset);

        return res.json({
          products,
          count,
          offset: requestedOffset,
          limit: requestedLimit,
        });
      }

      // 비멤버: 전체 조회 후 필터링
      const allProducts = await fetchAllProductsViaQuery(req, filters);
      const filteredProducts = applyMembershipFilter(allProducts, isMember);

      const pagedProducts = filteredProducts.slice(requestedOffset, requestedOffset + requestedLimit);

      return res.json({
        products: pagedProducts,
        count: filteredProducts.length,
        offset: requestedOffset,
        limit: requestedLimit,
      });
    }

    // 정렬 있음: 전체 조회 → 멤버십 필터링 → 정렬 → 페이징
    const allProducts = await fetchAllProductsViaQuery(req, filters);
    const filteredProducts = applyMembershipFilter(allProducts, isMember);

    // 정렬 키 조회
    const productIds = filteredProducts.map((p) => p.id);
    const sortKeys =
      productIds.length > 0 ? await productSortModule.listProductSortKeys({ product_id: productIds }) : [];

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
