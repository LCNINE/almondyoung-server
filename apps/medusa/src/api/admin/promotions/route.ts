import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, remoteQueryObjectFromString } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../modules/promotion-meta/service';
import { PROMOTION_FIELDS, toMetadataShape } from './helpers';

/**
 * `GET /admin/promotions` **만** override 한다 (#488 N8 · 7-8).
 *
 * 쓰기(`POST`)는 코어 핸들러가 처리한다. Medusa 는 라우트를 **메서드 단위로 병합**하므로
 * (`framework/dist/http/routes-loader.js` 의 `#routes[matcher][method]`), 이 파일이 `GET` 만
 * export 하면 코어의 `POST` 가 그대로 살아난다 — 2026-08-31 실측(우리 파일에서 POST 를 지우고
 * 부팅 → `POST /admin/promotions` 200, 프로모션 생성됨).
 *
 * `promotion_meta` 쓰기는 `workflows/hooks/promotion/promotion-meta.ts` 로 옮겼다. 그래야 실패 시
 * 프로모션이 함께 롤백된다. 옛 POST 의 `req.validatedBody ?? req.body` 폴백도 함께 사라진다 —
 * 그 폴백은 방어가 아니라 **은폐**였다(코어 미들웨어가 안 붙으면 무검증 본문이 조용히 통과).
 *
 * `GET` 을 남기는 이유: admin-web 이 `metadata`(=`visibility`·`issued_count`)를 여기서 받는다.
 * 읽기 override 의 위험은 「코어 개선을 못 받는다」뿐이고 원자성·검증과 무관하다.
 */

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
