import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, MedusaError, remoteQueryObjectFromString } from '@medusajs/framework/utils';
import { createPromotionsWorkflow } from '@medusajs/core-flows';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../modules/promotion-meta/service';
import { PROMOTION_FIELDS, toMetadataShape, extractMetaFromAdditionalData } from './helpers';

type PromotionMutationBody = Record<string, unknown> & {
  additional_data?: Record<string, unknown>;
};

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const limit = Math.min(parseInt(req.query.limit as string) || 20, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const q = req.query.q as string | undefined;

  const filters: Record<string, unknown> = {};
  if (q) filters.code = { $ilike: `%${q}%` };

  // validateAndTransformQuery 미들웨어가 *campaign 등을 올바르게 처리한 fields를 제공
  const fields = (req as any).queryConfig?.fields ?? PROMOTION_FIELDS;

  const queryObject = remoteQueryObjectFromString({
    entryPoint: 'promotion',
    variables: {
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      take: limit,
      skip: offset,
    },
    fields,
  });

  const { rows: promotions, metadata } = await remoteQuery(queryObject);

  const promotionIds = (promotions as any[]).map((p: any) => p.id);
  const metas = await promotionMetaService.getByPromotionIds(promotionIds);
  const metaMap = new Map((metas as any[]).map((m: any) => [m.promotion_id, m]));

  const promotionsWithMeta = (promotions as any[]).map((p: any) => ({
    ...p,
    metadata: toMetadataShape(metaMap.get(p.id)),
  }));

  return res.json({
    promotions: promotionsWithMeta,
    count: (metadata as any)?.count ?? promotions.length,
    offset,
    limit,
  });
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { additional_data, ...rest } = req.validatedBody as PromotionMutationBody;
  const promotionMetadata = extractMetaFromAdditionalData(additional_data);

  const { result } = await createPromotionsWorkflow(req.scope).run({
    input: { promotionsData: [rest as any], additional_data },
  });

  const promotionId = result[0].id;

  if (promotionMetadata) {
    const promotionMetaService = req.scope.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
    await promotionMetaService.upsert({ promotion_id: promotionId, ...promotionMetadata });
  }

  // POST 응답에는 *campaign 같은 wildcard 없이 기본 필드만. GET 목록 갱신 시 queryConfig.fields를 씀
  const fields = (req as any).queryConfig?.fields ?? [
    'id', 'code', 'is_automatic', 'type', 'status', 'campaign_id',
    'created_at', 'updated_at',
  ];

  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const queryObject = remoteQueryObjectFromString({
    entryPoint: 'promotion',
    variables: { filters: { id: promotionId } },
    fields,
  });
  const promotions = await remoteQuery(queryObject);

  if (!promotions?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Promotion ${promotionId} not found after creation`);
  }

  return res.status(200).json({ promotion: { ...promotions[0], metadata: toMetadataShape(promotionMetadata) } });
}
