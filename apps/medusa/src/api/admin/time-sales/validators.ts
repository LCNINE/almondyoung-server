import { z } from 'zod';

const price = z.object({ variant_id: z.string().min(1), amount: z.number().positive().finite() });

export const AdminTimeSaleWrite = z.object({
  title: z.string().trim().min(1),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  status: z.enum(['draft', 'active']),
  general_prices: z.array(price).min(1),
  membership_prices: z.array(price),
});

export type AdminTimeSaleWriteType = z.infer<typeof AdminTimeSaleWrite>;
