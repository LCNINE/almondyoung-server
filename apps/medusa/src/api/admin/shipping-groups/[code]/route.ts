import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils';
import { deleteShippingOptionsWorkflow } from '@medusajs/medusa/core-flows';

import {
  assertDeletableShippingGroup,
  parseShippingGroupInput,
} from '../../../../modules/almond-fulfillment/parse-shipping-group-input';
import {
  listShippingGroups,
  provisionShippingGroup,
} from '../../../../modules/almond-fulfillment/provision-shipping-group';

/**
 * 배송비 그룹 수정.
 * POST /admin/shipping-groups/:code
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const code = req.params.code;
  const group = parseShippingGroupInput(req.body, code);

  const existing = await listShippingGroups(req.scope);
  if (!existing.some((candidate) => candidate.code === code)) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `배송비 그룹을 찾을 수 없습니다: ${code}`);
  }

  await provisionShippingGroup(req.scope, group);
  const updated = await listShippingGroups(req.scope);
  res.json({ shipping_group: updated.find((candidate) => candidate.code === code) });
};

/**
 * 배송비 그룹 삭제.
 * DELETE /admin/shipping-groups/:code
 *
 * 이 그룹을 쓰는 상품이 하나라도 있으면 거부한다. 그냥 지우면 그 상품들은 배송옵션이 없는
 * shipping profile 을 가리키게 되고, 장바구니에 담기는 순간 결제가 불가능해진다.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const code = req.params.code;
  assertDeletableShippingGroup(code);

  const groups = await listShippingGroups(req.scope);
  const group = groups.find((candidate) => candidate.code === code);
  if (!group) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `배송비 그룹을 찾을 수 없습니다: ${code}`);
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  // product 그래프는 shipping_profile_id 로 필터할 수 없다(링크 테이블에 있는 컬럼이다).
  // 링크 엔티티를 직접 조회한다.
  const { metadata } = await query.graph({
    entity: 'product_shipping_profile',
    fields: ['product_id'],
    filters: { shipping_profile_id: group.shippingProfileId },
    pagination: { take: 1, skip: 0 },
  });
  const attachedProductCount = metadata?.count ?? 0;
  if (attachedProductCount > 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `이 배송비 그룹을 사용하는 상품이 ${attachedProductCount}개 있습니다. 상품의 배송비 그룹을 먼저 바꾸세요.`,
    );
  }

  await deleteShippingOptionsWorkflow(req.scope).run({ input: { ids: [group.shippingOptionId] } });
  await req.scope.resolve(Modules.FULFILLMENT).deleteShippingProfiles([group.shippingProfileId]);

  res.json({ id: code, object: 'shipping_group', deleted: true });
};
