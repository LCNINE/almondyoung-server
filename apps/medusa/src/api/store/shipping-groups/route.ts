import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { listShippingGroups } from '../../../modules/almond-fulfillment/provision-shipping-group';

/**
 * 배송비 그룹 정책 공개 조회.
 * GET /store/shipping-groups
 *
 * 상품상세의 배송비 안내와 장바구니 무료배송 진행바가 쓴다. 카트 없이도 "이 상품 배송비가 얼마인지"
 * 를 보여줘야 하는데 /store/shipping-options 는 cart_id 가 필수라 쓸 수 없다.
 * 금액의 단일 진실은 shipping option 의 data 이므로 복제본이 생기지 않는다.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const groups = await listShippingGroups(req.scope);

  res.json({
    shipping_groups: groups.map(({ code, name, policy, delivery, description }) => ({ code, name, policy, delivery, description })),
  });
};
