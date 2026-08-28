import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { getActiveTimeSale } from '../../../utils/time-sale';

/**
 * 진행 중인 타임세일. 없으면 `{ timeSale: null }`.
 *
 * 상품은 id 만 돌려주고 실제 조회는 스토어프론트가 `/store/products` 로 한다 — 그래야 멤버십 은닉
 * 미들웨어·가격 계산·리뷰 매핑이 다른 목록과 똑같이 걸린다. 여기서 상품을 통째로 내려보내면
 * 그 경로를 통째로 우회하게 된다.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const timeSale = await getActiveTimeSale(req.scope);

  if (!timeSale) {
    return res.json({ timeSale: null });
  }

  return res.json({
    timeSale: {
      title: timeSale.title,
      startsAt: timeSale.startsAt,
      endsAt: timeSale.endsAt,
      priceListIds: timeSale.priceListIds,
      productIds: timeSale.productIds,
    },
  });
}
