import type { AuthenticatedMedusaRequest, MedusaNextFunction, MedusaResponse } from '@medusajs/framework/http';
import {
  isRecord,
  isVisibleToMembersOnlyProduct,
  resolveMemberState,
  transformStoreProductsPayload,
  type MembershipProduct,
} from '../../../../utils/membership-filter';
import { CATALOG_SEGMENT_ECHO_FIELD } from './catalog-segment';

/**
 * 멤버십가 표시 정책 응답 미들웨어
 *
 * /store/products, /store/products/:id, /store/products-sorted 응답에서
 * 비회원이면 멤버십가 숨김 상품(metadata.hideMembershipPriceForNonMembers=true)의
 * variant.metadata 멤버십가 숫자를 제거한다.
 * 비회원이 members-only 상품 단건에 접근하면 not_found 성격의 404를 반환한다.
 *
 * 앞단에 authenticate('customer', ..., { allowUnauthenticated: true })가 있어야
 * 로그인 고객의 req.auth_context가 채워진다.
 */
export const membershipPriceVisibilityMiddleware = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) => {
  const { isMember, appliedSegment } = await resolveMemberState(req);

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (
      !isMember &&
      isRecord(body) &&
      isRecord(body.product) &&
      isVisibleToMembersOnlyProduct(body.product as MembershipProduct)
    ) {
      res.status(404);
      return originalJson({ type: 'not_found', message: 'Product not found' });
    }

    const payload = transformStoreProductsPayload(body, isMember);

    // 적용이 끝난 세그먼트만 에코한다. 에코는 주장의 반복이 아니라 적용의 증명이라,
    // 스토어프론트는 이 값이 자기 주장과 다르면 응답을 캐시하지 않고 토큰으로 되받는다.
    if (appliedSegment && isRecord(payload)) {
      return originalJson({ ...payload, [CATALOG_SEGMENT_ECHO_FIELD]: appliedSegment });
    }

    return originalJson(payload);
  };

  next();
};
