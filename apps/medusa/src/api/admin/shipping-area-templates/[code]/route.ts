import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';

import { deleteAreaTemplate, listAreaTemplates } from '../../../../modules/almond-fulfillment/area-templates';
import { listShippingGroups } from '../../../../modules/almond-fulfillment/provision-shipping-group';

/**
 * 지역별 배송비 템플릿 삭제.
 * DELETE /admin/shipping-area-templates/:code
 *
 * 이 템플릿을 쓰는 배송비 그룹이 있으면 거부한다. 그냥 지우면 그룹이 존재하지 않는 템플릿을
 * 가리킨 채 남아 지역 추가비가 조용히 0 이 된다.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const code = req.params.code;

  const templates = await listAreaTemplates(req.scope);
  if (!templates.some((template) => template.code === code)) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `지역별 배송비 템플릿을 찾을 수 없습니다: ${code}`);
  }

  const groups = await listShippingGroups(req.scope);
  const usedBy = groups.filter((group) => group.areaTemplateCode === code);
  if (usedBy.length > 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `이 템플릿을 사용하는 배송비 그룹이 있습니다: ${usedBy.map((group) => group.name).join(', ')}`,
    );
  }

  await deleteAreaTemplate(req.scope, code);
  res.json({ id: code, object: 'shipping_area_template', deleted: true });
};
