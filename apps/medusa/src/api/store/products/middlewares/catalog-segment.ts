import { timingSafeEqual } from 'crypto';
import type { AuthenticatedMedusaRequest, MedusaNextFunction, MedusaResponse } from '@medusajs/framework/http';

export const CATALOG_SEGMENT_HEADER = 'x-catalog-segment';
export const CATALOG_SEGMENT_KEY_HEADER = 'x-catalog-segment-key';

export type CatalogSegment = 'mem' | 'reg';

/** 요청에 신뢰된 세그먼트가 실렸을 때 그 판정을 담아두는 키. */
export const CATALOG_SEGMENT_STATE = Symbol.for('almondyoung.catalogSegment');

const safeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const readHeader = (req: AuthenticatedMedusaRequest, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

/**
 * 카탈로그 응답은 개인이 아니라 (region, 수량, 멤버십 여부)의 함수다. 고객 그룹 룰이 걸린
 * price list 는 멤버십 하나뿐이라 회원/비회원 두 벌이면 전부 표현된다.
 *
 * 개인 토큰으로 판정하면 스토어프론트의 fetch 캐시가 회원 수만큼 쪼개져 캐시가 무의미해진다.
 * 그래서 서버끼리만 아는 시크릿이 맞을 때 세그먼트 헤더를 판정 근거로 받는다.
 * 시크릿이 없거나 틀리면 기존 토큰 기반 판정으로 그대로 떨어진다.
 */
export const resolveTrustedCatalogSegment = (req: AuthenticatedMedusaRequest): CatalogSegment | null => {
  const secret = process.env.CATALOG_SEGMENT_SECRET?.trim();
  if (!secret) {
    return null;
  }

  const provided = readHeader(req, CATALOG_SEGMENT_KEY_HEADER);
  if (!provided || !safeEquals(provided, secret)) {
    return null;
  }

  const segment = readHeader(req, CATALOG_SEGMENT_HEADER);
  return segment === 'mem' || segment === 'reg' ? segment : null;
};

/**
 * 신뢰된 세그먼트가 있으면 그것으로 가격 계산 컨텍스트를 정한다.
 *
 * 코어의 setPricingContext 가 먼저 돌아 region/currency 를 채워두므로 여기서는 고객 그룹만
 * 갈아끼운다. 세그먼트가 없으면 아무것도 하지 않는다.
 */
export const catalogSegmentPricingMiddleware = (
  req: AuthenticatedMedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction,
) => {
  const segment = resolveTrustedCatalogSegment(req);
  if (!segment) {
    return next();
  }

  const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim();
  const request = req as AuthenticatedMedusaRequest & {
    pricingContext?: Record<string, unknown>;
    [CATALOG_SEGMENT_STATE]?: boolean;
  };

  request[CATALOG_SEGMENT_STATE] = segment === 'mem';
  request.pricingContext = {
    ...(request.pricingContext ?? {}),
    customer: {
      groups: segment === 'mem' && membershipGroupId ? [{ id: membershipGroupId }] : [],
    },
  };

  return next();
};
