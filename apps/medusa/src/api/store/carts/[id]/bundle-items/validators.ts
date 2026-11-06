import { z } from 'zod';

export const StoreAddBundleItems = z.object({
  /** 상세에서 함께 담는 부모 상품(A)의 카트 라인 */
  parent_line_id: z.string().min(1),
  items: z
    .array(z.object({ variant_id: z.string().min(1), quantity: z.number().int().gt(0) }))
    .min(1)
    .max(5),
});

export type StoreAddBundleItemsBody = z.infer<typeof StoreAddBundleItems>;
