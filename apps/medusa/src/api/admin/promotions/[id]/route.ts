import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { updatePromotionsWorkflow, deletePromotionsWorkflow } from '@medusajs/core-flows';
import { PROMOTION_META_MODULE } from '../../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../../modules/promotion-meta/service';
import { fetchPromotionWithMeta, extractMetaFromAdditionalData } from '../helpers';

type PromotionMutationBody = Record<string, unknown> & {
  additional_data?: Record<string, unknown>;
};

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotion = await fetchPromotionWithMeta(req.params.id, req.scope);
  return res.status(200).json({ promotion });
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { additional_data, ...rest } = req.validatedBody as PromotionMutationBody;
  const promotionMetadata = extractMetaFromAdditionalData(additional_data);

  await updatePromotionsWorkflow(req.scope).run({
    input: { promotionsData: [{ id: req.params.id, ...rest }], additional_data },
  });

  if (promotionMetadata) {
    const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
    await promotionMetaService.upsert({ promotion_id: req.params.id, ...promotionMetadata });
  }

  const promotion = await fetchPromotionWithMeta(req.params.id, req.scope);
  return res.status(200).json({ promotion });
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const id = req.params.id;

  await deletePromotionsWorkflow(req.scope).run({ input: { ids: [id] } });

  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
  await promotionMetaService.deleteByPromotionId(id);

  return res.status(200).json({ id, object: 'promotion', deleted: true });
}
