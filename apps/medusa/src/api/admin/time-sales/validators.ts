import { z } from 'zod';

const price = z.object({ variant_id: z.string().min(1), amount: z.number().positive().finite() });

export const AdminTimeSaleWrite = z.object({
  title: z.string().trim().min(1),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  status: z.enum(['draft', 'active']),
  general_prices: z.array(price),
  membership_prices: z.array(price),
  product_order: z.array(z.string().min(1)).optional(),
});

export type AdminTimeSaleWriteType = z.infer<typeof AdminTimeSaleWrite>;
