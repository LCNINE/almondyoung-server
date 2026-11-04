import { z } from 'zod';

const tierPrice = z.object({
  variant_id: z.string().min(1),
  min_quantity: z.number().int().min(2),
  amount: z.number().nonnegative().finite(),
});

export const AdminQuantityDiscountSync = z.object({
  period: z.object({ starts_at: z.string().datetime().nullable(), ends_at: z.string().datetime().nullable() }).nullable(),
  general: z.array(tierPrice),
  membership: z.array(tierPrice),
});

export type AdminQuantityDiscountSyncType = z.infer<typeof AdminQuantityDiscountSync>;
