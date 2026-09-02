import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

/**
 * 발급된 «한 장» 을 읽는 리더. 링크 행(customer↔promotion)의 우리 컬럼들만 뽑는다.
 *
 * `validity.ts` 옆 모듈 레벨에 두는 이유(W5, 2026-08-31): 스토어 라우트·카트 미들웨어·
 * 워크플로 훅(체크아웃 `validate`)이 전부 이 리더에 의존한다. 옛 위치(`api/admin/promotions/`)는
 * 워크플로 훅이 `api/admin/` 을 참조하는 계층 역전이었고, admin 전용 관심사(인가·DTO 정형)가
 * 이 함수에 얹힐 위험을 안고 있었다. `api/` 아래 어떤 것도 여기서 import 하지 않는다.
 */
export type IssuedLinkRow = {
  customer_id: string;
  promotion_id: string;
  expires_at: string | Date | null;
  used_at: string | Date | null;
  order_id: string | null;
  issued_via: string | null;
};

const ISSUED_LINK_FIELDS = [
  'customer_id',
  'promotion_id',
  'expires_at',
  'used_at',
  'order_id',
  'issued_via',
];

function customerPromotionLinkModule(scope: any) {
  return (scope.resolve(ContainerRegistrationKeys.LINK) as any).getLinkModule(
    Modules.CUSTOMER,
    'customer_id',
    Modules.PROMOTION,
    'promotion_id',
  );
}

/**
 * 이 고객이 이 쿠폰을 발급받았는가 — 받았다면 그 «한 장»의 상태를 돌려준다.
 *
 * 스칼라 필터 한 쌍으로 조회한다. (배열 필터는 이 링크 모듈에서 신뢰하지 않는 것이 저장소
 * 관례라 `listIssuedLinks` 도 고객 하나로만 좁힌다. 스칼라 조회가 도는 것은
 * `integration-tests/http/coupon-validity.spec.ts` 의 T3 마지막 케이스가 확인한다.)
 */
export async function findIssuedLink(
  scope: any,
  customerId: string,
  promotionId: string,
): Promise<IssuedLinkRow | null> {
  const rows = (await customerPromotionLinkModule(scope).list(
    { customer_id: customerId, promotion_id: promotionId },
    { select: ISSUED_LINK_FIELDS },
  )) as IssuedLinkRow[];
  return rows?.[0] ?? null;
}

/** 이 고객이 가진 모든 «한 장». 호출부가 프로모션마다 조회하지 않도록 한 번에 가져온다. */
export async function listIssuedLinks(scope: any, customerId: string): Promise<IssuedLinkRow[]> {
  return (await customerPromotionLinkModule(scope).list(
    { customer_id: customerId },
    { select: ISSUED_LINK_FIELDS },
  )) as IssuedLinkRow[];
}
