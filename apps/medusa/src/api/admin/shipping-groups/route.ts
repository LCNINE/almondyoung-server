import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { parseShippingGroupInput } from '../../../modules/almond-fulfillment/parse-shipping-group-input';
import {
  listShippingGroups,
  provisionShippingGroup,
} from '../../../modules/almond-fulfillment/provision-shipping-group';

/**
 * 배송비 그룹 목록.
 * GET /admin/shipping-groups
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const shipping_groups = await listShippingGroups(req.scope);
  res.json({ shipping_groups, count: shipping_groups.length });
};

/**
 * 배송비 그룹 생성 / 정책 갱신 (code 기준 upsert).
 * POST /admin/shipping-groups
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const group = parseShippingGroupInput(req.body);
  await provisionShippingGroup(req.scope, group);

  const shipping_groups = await listShippingGroups(req.scope);
  res.json({ shipping_group: shipping_groups.find((candidate) => candidate.code === group.code) });
};
