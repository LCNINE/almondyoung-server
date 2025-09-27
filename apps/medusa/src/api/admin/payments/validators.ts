import { createSelectParams } from '@medusa/utils/validators';
import { z } from 'zod';

export type AdminGetPaymentParamsType = z.infer<typeof AdminGetPaymentParams>;
export const AdminGetPaymentParams = createSelectParams();

export type AdminCreatePaymentRefundType = z.infer<
  typeof AdminCreatePaymentRefund
>;

export const AdminCreatePaymentRefund = z
  .object({
    amount: z.number().optional(),
    refund_reason_id: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
