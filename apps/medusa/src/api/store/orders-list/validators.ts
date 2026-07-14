import { z } from 'zod';
import { createFindParams } from 'src/utils/validators';

// created_at 범위 필터 연산자 스키마. 표준 /store/orders 는 이걸 막지만(strict),
// 이 커스텀 목록은 기간 조회를 위해 허용한다.
const DateComparisonOperator = z
  .object({
    $gte: z.string().optional(),
    $lte: z.string().optional(),
    $gt: z.string().optional(),
    $lt: z.string().optional(),
  })
  .strict();

export const StoreGetOrdersListParams = createFindParams({
  offset: 0,
  limit: 20,
}).merge(
  z.object({
    id: z.union([z.string(), z.array(z.string())]).optional(),
    status: z.union([z.string(), z.array(z.string())]).optional(),
    created_at: DateComparisonOperator.optional(),
    /** 상품명 검색어 — 주문 아이템 title ilike 매칭 */
    q: z.string().max(100).optional(),
  }),
);

export type StoreGetOrdersListParamsType = z.infer<typeof StoreGetOrdersListParams>;
