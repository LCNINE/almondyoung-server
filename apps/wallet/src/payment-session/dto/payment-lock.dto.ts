import { z } from 'zod';

export const createPaymentLockSchema = z.object({
  paymentSessionId: z.string().length(26),
  deviceFingerprint: z.string().max(64).optional(),
  userAgent: z.string().optional(),
  ipAddress: z.string().max(45).optional(),
  expiresInMinutes: z.number().positive().default(15),
});

export type CreatePaymentLockDto = z.infer<typeof createPaymentLockSchema>;

export const validatePaymentLockSchema = z.object({
  lockToken: z.string().length(128),
});

export type ValidatePaymentLockDto = z.infer<typeof validatePaymentLockSchema>;

export const paymentLockResponseSchema = z.object({
  id: z.string(),
  paymentSessionId: z.string(),
  lockToken: z.string(),
  deviceFingerprint: z.string().optional(),
  userAgent: z.string().optional(),
  ipAddress: z.string().optional(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'COMPLETED']),
  expiresAt: z.date(),
  createdAt: z.date(),
});

export type PaymentLockResponseDto = z.infer<typeof paymentLockResponseSchema>;