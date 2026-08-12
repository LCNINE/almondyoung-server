import type { AuthenticatedMedusaRequest } from '@medusajs/framework/http';

/**
 * 가격 계산 컨텍스트를 조립한다: (라우트 기본값) + (코어/세그먼트가 채운 컨텍스트).
 *
 * 코어의 setPricingContext 는 `/store/products` 계열 표준 라우트에만 붙는다. 커스텀 라우트는
 * 그게 안 돌아 currency_code 를 스스로 채워야 하는데, 예전 코드는 `req.pricingContext ?? 기본값`
 * 이라 컨텍스트가 조금이라도 채워져 있으면 기본값이 통째로 죽었다. 세그먼트 미들웨어가
 * 고객 그룹만 넣어두면 통화가 빠진 컨텍스트가 되어 **멤버십 회원만 가격이 null** 이 됐다.
 *
 * 그래서 `??` 로 고르는 게 아니라 키 단위로 합친다. 기본값은 빈 자리를 메우기만 하고,
 * 이미 정해진 값(코어의 region/currency, 세그먼트의 고객 그룹)은 그대로 이긴다.
 */
export const buildPricingContext = (
  req: AuthenticatedMedusaRequest,
  fallback: Record<string, unknown>,
): Record<string, unknown> => {
  const resolved = (req as AuthenticatedMedusaRequest & { pricingContext?: Record<string, unknown> })
    .pricingContext;

  return { ...fallback, ...(resolved ?? {}) };
};
