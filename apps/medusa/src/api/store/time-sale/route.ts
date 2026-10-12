import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { listActiveStoreTimeSales } from '../../../utils/time-sale';

/**
 * 진행 중인 타임세일 전부. 없으면 `{ timeSales: [], products: [] }`.
 *
 * 상품은 id 만 돌려주고 실제 조회는 스토어프론트가 `/store/products` 로 한다 — 그래야 멤버십 은닉
 * 미들웨어·가격 계산·리뷰 매핑이 다른 목록과 똑같이 걸린다.
 *
 * 세일 이름은 싣지 않는다(운영자 내부용). `timeSales` 는 예전 응답과 같은 모양에서 title 만 빠졌으므로
 * 배포가 섞여도 옛 스토어프론트는 기본 문구로 그린다.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.json(await listActiveStoreTimeSales(req.scope));
}
