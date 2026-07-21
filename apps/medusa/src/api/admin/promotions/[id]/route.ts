import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { updatePromotionsWorkflow, deletePromotionsWorkflow } from '@medusajs/core-flows';
import { PROMOTION_META_MODULE } from '../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../modules/promotion-meta/service';
import { fetchPromotionWithMeta, extractMetaFromAdditionalData } from '../helpers';

type PromotionMutationBody = Record<string, unknown> & {
  additional_data?: Record<string, unknown>;
};

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const fields = (req as any).queryConfig?.fields;
  const promotion = await fetchPromotionWithMeta(req.params.id, req.scope, fields);
  return res.status(200).json({ promotion });
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  // validatedBody는 Medusa 코어 validator 미들웨어가 채운다. 미적용 시 body로 폴백해 크래시 방지.
  const { additional_data, ...rest } = (req.validatedBody ?? req.body) as PromotionMutationBody;
  const promotionMetadata = extractMetaFromAdditionalData(additional_data);

  await updatePromotionsWorkflow(req.scope).run({
    input: { promotionsData: [{ id: req.params.id, ...rest }], additional_data },
  });

  if (promotionMetadata) {
    const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
    await promotionMetaService.upsert({ promotion_id: req.params.id, ...promotionMetadata });
  }

  const fields = (req as any).queryConfig?.fields;
  const promotion = await fetchPromotionWithMeta(req.params.id, req.scope, fields);
  return res.status(200).json({ promotion });
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const id = req.params.id;

  await deletePromotionsWorkflow(req.scope).run({ input: { ids: [id] } });

  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  await promotionMetaService.deleteByPromotionId(id);
  // 발급 로그 고아 로우 정리 (링크는 deletePromotionsWorkflow 가 cascade 처리)
  await promotionMetaService.removeAllIssueLogs(id).catch(() => {});

  return res.status(200).json({ id, object: 'promotion', deleted: true });
}
