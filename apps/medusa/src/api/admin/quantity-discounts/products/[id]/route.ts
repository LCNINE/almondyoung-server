import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { syncProductQuantityDiscountWorkflow } from '../../../../../workflows/quantity-discount/workflows';
import type { AdminQuantityDiscountSyncType } from './validators';

/** 상품 하나의 수량 할인 가격을 통째로 교체한다. 빈 배열 둘이면 이 상품의 구간가를 모두 뺀다. */
export async function POST(req: MedusaRequest<AdminQuantityDiscountSyncType>, res: MedusaResponse) {
  const { result } = await syncProductQuantityDiscountWorkflow(req.scope).run({
    input: { product_id: req.params.id, ...req.validatedBody },
  });
  return res.json(result);
}
