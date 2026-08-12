import { timingSafeEqual } from 'crypto';
import type { AuthenticatedMedusaRequest, MedusaNextFunction, MedusaResponse } from '@medusajs/framework/http';

export const CATALOG_SEGMENT_HEADER = 'x-catalog-segment';
export const CATALOG_SEGMENT_KEY_HEADER = 'x-catalog-segment-key';

/** 응답에 "실제로 적용한 세그먼트"를 실어 보내는 필드. 스토어프론트가 이걸로 검증한다. */
export const CATALOG_SEGMENT_ECHO_FIELD = 'catalog_segment';

export type CatalogSegment = 'mem' | 'reg';

/** 적용이 끝난 세그먼트를 담아두는 키. 주장(헤더)이 아니라 적용 결과만 들어간다. */
export const CATALOG_SEGMENT_STATE = Symbol.for('almondyoung.catalogSegment');

type SegmentCarrier = AuthenticatedMedusaRequest & {
  pricingContext?: Record<string, unknown>;
  [CATALOG_SEGMENT_STATE]?: CatalogSegment;
};

const safeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const readHeader = (req: AuthenticatedMedusaRequest, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

/** 요청이 적용받은 세그먼트. 적용된 게 없으면 undefined. */
export const getAppliedCatalogSegment = (req: AuthenticatedMedusaRequest): CatalogSegment | undefined => {
  return (req as SegmentCarrier)[CATALOG_SEGMENT_STATE];
};

/**
 * 카탈로그 응답은 개인이 아니라 (region, 수량, 멤버십 여부)의 함수다. 고객 그룹 룰이 걸린
 * price list 는 멤버십 하나뿐이라 회원/비회원 두 벌이면 전부 표현된다
 * (그 전제는 catalog-price-list-guard 잡이 주기적으로 검증한다).
 *
 * 개인 토큰으로 판정하면 스토어프론트의 캐시가 회원 수만큼 쪼개져 캐시가 무의미해진다.
 * 그래서 서버끼리만 아는 시크릿이 맞을 때 세그먼트 헤더를 판정 근거로 받는다.
 */
const resolveClaimedSegment = (req: AuthenticatedMedusaRequest): CatalogSegment | null => {
  const segment = readHeader(req, CATALOG_SEGMENT_HEADER);
  return segment === 'mem' || segment === 'reg' ? segment : null;
};

/**
 * 세그먼트 주장을 검증하고, 온전히 적용할 수 있을 때만 적용한다.
 *
 * 핵심 규칙: **mem 을 온전히 적용할 수 없으면 mem 으로 표시하지 않는다.** 멤버십 그룹 id 가
 * 비어 있으면 가격은 비회원가인데 회원 표시만 서는 반쪽 응답이 만들어지고, 그게 스토어프론트
 * 회원 칸에 캐시되면 TTL 동안 회원 전체가 비회원가를 본다. 그래서 그 경우엔 적용을 포기하고
 * 에코도 하지 않는다 — 스토어프론트가 불일치를 보고 토큰 경로로 되돌아간다.
 */
export const catalogSegmentPricingMiddleware = (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) => {
  const claimed = resolveClaimedSegment(req);
  const providedKey = readHeader(req, CATALOG_SEGMENT_KEY_HEADER);
  const secret = process.env.CATALOG_SEGMENT_SECRET?.trim();

  // 시크릿을 실어 보냈는데 안 맞는다 = 설정이 어긋났거나 위조다. 조용히 비회원 응답을
  // 주면 그게 회원 칸에 캐시되므로 요청 자체를 거절한다.
  if (providedKey && (!secret || !safeEquals(providedKey, secret))) {
    return res.status(400).json({
      type: 'invalid_data',
      message: 'Invalid catalog segment key',
    });
  }

  // 토큰과 세그먼트를 같이 보내면 어느 쪽으로 판정했는지가 응답에서 안 드러난다.
  // 캐시 키와 응답이 어긋나는 대표적인 경로라 아예 막는다.
  if (claimed && readHeader(req, 'authorization')) {
    return res.status(400).json({
      type: 'invalid_data',
      message: 'Catalog segment and authorization cannot be combined',
    });
  }

  // 주장이 없거나 시크릿으로 신뢰되지 않으면 아무것도 하지 않는다 — 기존 토큰 기반 판정.
  if (!claimed || !providedKey || !secret) {
    return next();
  }

  const request = req as SegmentCarrier;

  if (claimed === 'reg') {
    // reg 은 pricingContext 를 건드리지 않는다. `customer: { groups: [] }` 를 넣으면
    // 익명 요청과 컨텍스트 해시가 달라져 Medusa 쿼리 캐시에 같은 응답이 두 벌 잡힌다.
    request[CATALOG_SEGMENT_STATE] = 'reg';
    return next();
  }

  const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim();
  if (!membershipGroupId) {
    // 여기서 mem 을 표시하면 가격은 비회원가인 반쪽 응답이 된다. 적용도 에코도 하지 않는다.
    console.error(
      '[catalog-segment] MEDUSA_MEMBERSHIP_GROUP_ID 가 비어 mem 세그먼트를 적용할 수 없다. 토큰 경로로 폴백된다.',
    );
    return next();
  }

  request[CATALOG_SEGMENT_STATE] = 'mem';
  request.pricingContext = {
    ...(request.pricingContext ?? {}),
    customer: { groups: [{ id: membershipGroupId }] },
  };

  return next();
};
