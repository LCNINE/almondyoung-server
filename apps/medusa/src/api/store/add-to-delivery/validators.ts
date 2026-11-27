import { z } from 'zod';

export const StoreAddToDeliveryParentsQuery = z.object({ product_id: z.string().min(1) }).strict();

export const StoreAddToDeliveryCartCreate = z
  .object({ parent_order_id: z.string().min(1), variant_id: z.string().min(1) })
  .strict();

export const StoreAddToDeliveryLinksQuery = z
  .object({
    order_ids: z
      .string()
      .transform((v) => v.split(',').filter(Boolean))
      .pipe(z.array(z.string().min(1)).min(1).max(20)),
  })
  .strict();
