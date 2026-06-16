import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import {
  applyMembershipPriceVisibility,
  filterProductsForMemberState,
  isRecord,
  resolveMemberState,
  type MembershipProduct,
} from '../../../utils/membership-filter';

type StoreProductsResponse = {
  products: MembershipProduct[];
  count: number;
  offset?: number;
  limit?: number;
};

const DEFAULT_LIMIT = 12;

const toNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

/**
 * 멤버십가 표시 정책이 적용된 상품 목록 API
 *
 * 정책
 * - hideMembershipPriceForNonMembers=true: 비멤버에게 멤버십가 숫자(variant.metadata.membershipPrice)만 제거
 *   (스토어프론트는 멤버십가 영역에 "멤버십 회원 공개"를 표시)
 * - isVisibleToMembersOnly=true: 비멤버 목록 응답에서 제거
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const requestedLimit = toNumber(req.query.limit, DEFAULT_LIMIT);
  const requestedOffset = toNumber(req.query.offset, 0);

  try {
    const { customerId, isMember } = await resolveMemberState(req);

    console.log(`[membership-products] customerId: ${customerId}, isMember: ${isMember}`);

    const baseSearchParams = createBaseSearchParams(req);
    const response = await fetchStoreProducts(req, baseSearchParams);

    // 비멤버는 members-only 상품을 제거하고, 멤버십가 metadata만 제거된다.
    // (내부 /store/products 호출에도 동일 미들웨어가 적용되지만, 멱등이므로 여기서도 명시 적용)
    const products = filterProductsForMemberState(response.products, isMember).map((product) =>
      applyMembershipPriceVisibility(product, isMember),
    );

    return res.json({
      products,
      count: response.count,
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
