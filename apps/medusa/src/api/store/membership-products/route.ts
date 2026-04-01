import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';

type ProductMetadata = {
  isMembershipOnly?: boolean | string;
  [key: string]: unknown;
};

type ProductVariant = {
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type MembershipProduct = {
  id?: string;
  metadata?: ProductMetadata | null;
  variants?: ProductVariant[] | null;
  [key: string]: unknown;
};

type StoreProductsResponse = {
  products: MembershipProduct[];
  count: number;
  offset?: number;
  limit?: number;
};

type MemberState = {
  customerId?: string;
  isMember: boolean;
};

const DEFAULT_LIMIT = 12;
const SCAN_BATCH_SIZE = 100;

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

const toNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const isMembershipOnlyProduct = (product: MembershipProduct) => {
  return product.metadata?.isMembershipOnly === true || product.metadata?.isMembershipOnly === 'true';
};

const sanitizeMembershipPriceMetadata = (metadata: Record<string, unknown>) => {
  const next = { ...metadata };

  // snake/camel 모두 방어
  delete next.membershipPrice;
  delete next.membership_price;
  delete next.membershipprice;

  return next;
};

const sanitizeProductForNonMember = (product: MembershipProduct) => {
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

  return {
    ...product,
    variants,
  };
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

  // fetch 대상 호스트는 URL에서 결정되므로 host 헤더는 제거
  headers.delete('host');

  return headers;
};

const appendQueryParam = (searchParams: URLSearchParams, key: string, value: unknown) => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    searchParams.append(key, String(value));
  }
};

const createBaseSearchParams = (req: AuthenticatedMedusaRequest) => {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(req.query || {})) {
    if (value == null) {
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
    return {
      products: [],
      count: 0,
    };
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
    return {
      customerId,
      isMember: false,
    };
  }

  try {
    const graphResult: unknown = await query.graph({
      entity: 'customer',
      fields: ['id', 'groups.id'],
      filters: { id: customerId },
    });

    const customers = isRecord(graphResult) ? graphResult.data : undefined;

    if (!Array.isArray(customers)) {
      return {
        customerId,
        isMember: false,
      };
    }

    const firstCustomer = (customers as unknown[])[0];
    if (!isRecord(firstCustomer) || !Array.isArray(firstCustomer.groups)) {
      return {
        customerId,
        isMember: false,
      };
    }

    const isMember = firstCustomer.groups.some((group) => {
      return isRecord(group) && group.id === membershipGroupId;
    });

    return {
      customerId,
      isMember,
    };
  } catch (error) {
    console.error('[membership-products] 멤버십 확인 실패:', error);

    return {
      customerId,
      isMember: false,
    };
  }
};

/**
 * 멤버십 필터링이 적용된 상품 목록 API
 *
 * 정책
 * - isMembershipOnly=true: 비멤버에게 상품 자체를 숨김
 * - 롤리킹 지정 상품: 비멤버에게는 상품 노출하되 멤버십가(metadata) 제거
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const requestedLimit = toNumber(req.query.limit, DEFAULT_LIMIT);
  const requestedOffset = toNumber(req.query.offset, 0);

  try {
    const { customerId, isMember } = await resolveMemberState(req);

    console.log(`[membership-products] customerId: ${customerId}, isMember: ${isMember}`);

    const baseSearchParams = createBaseSearchParams(req);

    // 멤버십 회원은 기본 /store/products 응답을 그대로 반환
    if (isMember) {
      const memberResponse = await fetchStoreProducts(req, baseSearchParams);

      return res.json({
        products: memberResponse.products,
        count: memberResponse.count,
        offset: requestedOffset,
        limit: requestedLimit,
      });
    }

    // 비멤버십은 "필터 후 offset/limit" 기준이 되도록 전체 스캔
    const scanParams = new URLSearchParams(baseSearchParams);
    const scanLimit = Math.max(SCAN_BATCH_SIZE, requestedLimit);

    scanParams.set('limit', String(scanLimit));
    scanParams.set('offset', '0');

    const pagedProducts: MembershipProduct[] = [];
    let visibleTotal = 0;
    let seenVisible = 0;

    let rawOffset = 0;
    let rawCount = Number.POSITIVE_INFINITY;

    while (rawOffset < rawCount) {
      scanParams.set('offset', String(rawOffset));

      const batchResponse = await fetchStoreProducts(req, scanParams);
      rawCount = batchResponse.count;

      const batchProducts = batchResponse.products;

      if (batchProducts.length === 0) {
        break;
      }

      const visibleBatch = batchProducts
        .filter((product) => !isMembershipOnlyProduct(product))
        .map((product) => sanitizeProductForNonMember(product));

      for (const product of visibleBatch) {
        if (seenVisible >= requestedOffset && pagedProducts.length < requestedLimit) {
          pagedProducts.push(product);
        }

        seenVisible += 1;
      }

      visibleTotal += visibleBatch.length;
      rawOffset += batchProducts.length;
    }

    return res.json({
      products: pagedProducts,
      count: visibleTotal,
      offset: requestedOffset,
      limit: requestedLimit,
    });
  } catch (error) {
    console.error('[membership-products] 상품 조회 실패:', error);

    return res.json({
      products: [],
      count: 0,
      offset: requestedOffset,
      limit: requestedLimit,
    });
  }
};
