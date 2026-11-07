import { z } from 'zod';

// 코어 POST /store/carts/:id/line-items 의 본문과 같은 모양이다.
export const StoreAddLineItem = z.object({
  variant_id: z.string(),
  quantity: z.number().gt(0),
  metadata: z.record(z.unknown()).nullish(),
});

export type StoreAddLineItemBody = z.infer<typeof StoreAddLineItem>;
