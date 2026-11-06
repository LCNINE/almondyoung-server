import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { syncProductBundleOffersWorkflow } from '../../../../../workflows/bundle-offer/workflows';
import type { AdminBundleOfferSyncType } from './validators';

/** 상품 하나의 함께 구매 구성품을 통째로 교체한다. 빈 목록이면 모두 해제. */
export async function POST(req: MedusaRequest<AdminBundleOfferSyncType>, res: MedusaResponse) {
  const { result } = await syncProductBundleOffersWorkflow(req.scope).run({
    input: { product_id: req.params.id, ...req.validatedBody },
  });
  return res.json(result);
}
