import { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { fetchPromotionWithMeta } from '../helpers';

/**
 * `GET /admin/promotions/:id` **만** override 한다 (#488 N8 · 7-8).
 *
 * `POST`(수정)·`DELETE` 는 코어 핸들러가 처리하고, `promotion_meta` 정리는
 * `workflows/hooks/promotion/promotion-meta.ts` 의 `promotionsUpdated` · `promotionsDeleted`
 * 훅이 한다. Medusa 는 라우트를 **메서드 단위로 병합**하므로 이 파일이 `GET` 만 export 해도
 * 나머지 둘이 살아난다(2026-08-31 실측).
 *
 * `GET` 을 남기는 이유: admin-web 상세가 `metadata` 를 여기서 받는다.
 */

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const fields = (req as any).queryConfig?.fields;
  const promotion = await fetchPromotionWithMeta(req.params.id, req.scope, fields);
  return res.status(200).json({ promotion });
}
