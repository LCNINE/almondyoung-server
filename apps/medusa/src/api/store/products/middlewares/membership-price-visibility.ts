import type { AuthenticatedMedusaRequest, MedusaNextFunction, MedusaResponse } from '@medusajs/framework/http';
import { resolveMemberState, transformStoreProductsPayload } from '../../../../utils/membership-filter';

/**
 * 멤버십가 표시 정책 응답 미들웨어
 *
 * /store/products, /store/products/:id, /store/products-sorted 응답에서
 * 비회원이면 멤버십가 숨김 상품(metadata.isMembershipOnly=true)의
 * variant.metadata 멤버십가 숫자를 제거한다.
 *
 * 상품을 숨기거나 count를 바꾸지 않는다 — 표시 정책이지 접근/구매 제한이 아니다.
 * 앞단에 authenticate('customer', ..., { allowUnauthenticated: true })가 있어야
 * 로그인 고객의 req.auth_context가 채워진다.
 */
export const membershipPriceVisibilityMiddleware = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) => {
  const { isMember } = await resolveMemberState(req);

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => originalJson(transformStoreProductsPayload(body, isMember));

  next();
};
