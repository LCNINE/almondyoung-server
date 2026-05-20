import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils';
import { createPromotionsWorkflow } from '@medusajs/core-flows';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import { PROMOTION_FIELDS, toMetadataShape } from './helpers';

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const promotionMetaService = req.scope.resolve(PROMOTION_META_MODULE);

  const limit = Math.min(parseInt(req.query.limit as string) || 20, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const q = req.query.q as string | undefined;

  const filters: Record<string, unknown> = {};
  if (q) filters.code = { $ilike: `%${q}%` };

  const { data: promotions, metadata: queryMeta } = await query.graph({
    entity: 'promotion',
    fields: PROMOTION_FIELDS,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    pagination: { take: limit, skip: offset },
  });

  const promotionIds = (promotions as any[]).map((p) => p.id);
  const metas = await promotionMetaService.getByPromotionIds(promotionIds);
  const metaMap = new Map((metas as any[]).map((m) => [m.promotion_id, m]));

  const promotionsWithMeta = (promotions as any[]).map((p) => ({
    ...p,
    metadata: toMetadataShape(metaMap.get(p.id)),
  }));

  return res.json({
    promotions: promotionsWithMeta,
    count: (queryMeta as any)?.count ?? promotions.length,
    offset,
    limit,
  });
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotionMetadata = (req as any).promotionMetadata as Record<string, unknown> | undefined;
  const { additional_data, ...rest } = req.validatedBody;

  const { result } = await createPromotionsWorkflow(req.scope).run({
    input: { promotionsData: [rest], additional_data },
  });

  const promotionId = result[0].id;

  if (promotionMetadata && Object.keys(promotionMetadata).length > 0) {
    const promotionMetaService = req.scope.resolve(PROMOTION_META_MODULE);
    await promotionMetaService.upsert({ promotion_id: promotionId, ...promotionMetadata });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: promotions } = await query.graph({
    entity: 'promotion',
    fields: PROMOTION_FIELDS,
    filters: { id: promotionId },
  });

  if (!promotions?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotion ${promotionId} not found after creation`);
  }

  const meta = promotionMetadata && Object.keys(promotionMetadata).length > 0
    ? promotionMetadata
    : null;

  return res.status(200).json({ promotion: { ...(promotions as any[])[0], metadata: meta } });
}
