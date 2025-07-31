import { z } from 'zod';

export const updatePaymentSessionSchema = z.object({
  status: z.enum(['PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED']).optional(),
  metadata: z.record(z.any()).optional(),
  authorizedAt: z.date().optional(),
  capturedAt: z.date().optional(),
});

export type UpdatePaymentSessionDto = z.infer<typeof updatePaymentSessionSchema>;