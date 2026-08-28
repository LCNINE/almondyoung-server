import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { listActiveTimeSales } from '../../../utils/time-sale';

/**
 * 진행 중인 타임세일 전부. 없으면 `{ timeSales: [] }`.
 *
 * 상품은 id 만 돌려주고 실제 조회는 스토어프론트가 `/store/products` 로 한다 — 그래야 멤버십 은닉
 * 미들웨어·가격 계산·리뷰 매핑이 다른 목록과 똑같이 걸린다. 여기서 상품을 통째로 내려보내면
 * 그 경로를 통째로 우회하게 된다.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const timeSales = await listActiveTimeSales(req.scope);

  return res.json({
    timeSales: timeSales.map((sale) => ({
      title: sale.title,
      startsAt: sale.startsAt,
      endsAt: sale.endsAt,
      priceListIds: sale.priceListIds,
      productIds: sale.productIds,
    })),
  });
}
