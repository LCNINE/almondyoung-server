import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';

import { listAreaTemplates, upsertAreaTemplate } from '../../../modules/almond-fulfillment/area-templates';
import { parseAreaTemplateInput } from '../../../modules/almond-fulfillment/parse-shipping-group-input';
import { reprovisionGroupsUsingAreaTemplate } from '../../../modules/almond-fulfillment/provision-shipping-group';

/**
 * 지역별 배송비 템플릿 목록.
 * GET /admin/shipping-area-templates
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const shipping_area_templates = await listAreaTemplates(req.scope);
  res.json({ shipping_area_templates, count: shipping_area_templates.length });
};

/**
 * 지역별 배송비 템플릿 생성 / 수정 (code 기준 upsert).
 * POST /admin/shipping-area-templates
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const template = parseAreaTemplateInput(req.body);
  await upsertAreaTemplate(req.scope, template);

  // 지역 추가비는 그룹 배송옵션에 복사돼 있으므로 참조 그룹을 다시 저장해야 반영된다.
  const reprovisioned = await reprovisionGroupsUsingAreaTemplate(req.scope, template.code);

  res.json({ shipping_area_template: template, reprovisioned_group_count: reprovisioned });
};
