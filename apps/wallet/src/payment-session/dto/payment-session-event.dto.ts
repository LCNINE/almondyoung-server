import { z } from 'zod';

export const recordEventSchema = z.object({
  paymentSessionId: z.string().length(26),
  eventType: z.enum([
    'SESSION_CREATED',
    'LOCK_CREATED', 
    'PAYMENT_INITIATED',
    'PAYMENT_AUTHORIZED',
    'PAYMENT_CAPTURED',
    'PAYMENT_FAILED',
    'PAYMENT_CANCELLED',
    'REFUND_REQUESTED',
    'REFUND_COMPLETED',
    'SESSION_EXPIRED',
  ]),
  eventData: z.record(z.any()).optional(),
});

export type RecordEventDto = z.infer<typeof recordEventSchema>;

export const paymentSessionEventResponseSchema = z.object({
  id: z.string(),
  paymentSessionId: z.string(),
  eventType: z.string(),
  eventData: z.record(z.any()).optional(),
  occurredAt: z.date(),
});

export type PaymentSessionEventResponseDto = z.infer<typeof paymentSessionEventResponseSchema>;