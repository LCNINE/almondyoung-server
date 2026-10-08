import { syncTimeSaleProductActions } from '../../../../utils/time-sale-product-actions';
import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import { respondConflictWithMessage } from '../conflict';
import { clearTimeSaleProductCache, revalidateTimeSaleCache } from '../../../../utils/time-sale-settings';
import { setTimeSaleStatusWorkflow } from '../../../../workflows/time-sale/save-time-sale';

// 타임세일 활성/비활성 전환. 겹침 충돌은 409 로 응답하고, 성공하면 스토어프론트 캐시를 무효화한다.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as { priceListIds?: unknown; active?: unknown };
  const ids = body.priceListIds;

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id))
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'priceListIds 를 확인하세요.');
  if (typeof body.active !== 'boolean')
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'active 는 true 또는 false 여야 합니다.');

  const active = body.active;
  const changed = await respondConflictWithMessage(res, () =>
    setTimeSaleStatusWorkflow(req.scope).run({ input: { priceListIds: ids, active } }),
  );
  if (!changed.ok) return;

  // 가격표 상태만 바뀌면 Medusa 상품 캐시가 안 비워져 옛 가격이 남는다(Ruling 22).
  await clearTimeSaleProductCache(req.scope, changed.value.result.productIds);
  await syncTimeSaleProductActions(req.scope);

  await revalidateTimeSaleCache(req.scope);

  return res.json({ priceListIds: ids, active });
}
