import { z } from 'zod';

// Zod schema for validation
export const createPaymentSessionSchema = z.object({
  userId: z.string().min(1).max(64),
  amount: z.number().positive(),
  currency: z.string().length(3),


  metadata: z.record(z.any()).optional(),
  expiresInMinutes: z.number().positive().default(30),
});

export type CreatePaymentSessionDto = z.infer<typeof createPaymentSessionSchema>;

// Response DTO
export const paymentSessionResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.enum(['PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED']),

  metadata: z.record(z.any()).optional(),
  expiresAt: z.date(),
  authorizedAt: z.date().optional(),
  capturedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PaymentSessionResponseDto = z.infer<typeof paymentSessionResponseSchema>;