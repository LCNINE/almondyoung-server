import { z } from 'zod';

const id26 = z.string().length(26);

// DB에서 받는 실제 타입 (decimal은 string)
export const RefundEventDbSchema = z.object({
  id: id26,
  paymentEventId: id26,
  amount: z.string(), // DB decimal은 string
  status: z.enum(['REQUESTED', 'SUCCESS', 'FAILED']),
  reason: z.string().nullable().optional(),
  createdAt: z.date(),
});

// 비즈니스 로직에서 사용하는 타입 (amount는 number)
export const RefundEventSchema = z.object({
  id: id26,
  paymentEventId: id26,
  amount: z.number().positive(), // 비즈니스 로직에서는 number
  status: z.enum(['REQUESTED', 'SUCCESS', 'FAILED']),
  reason: z.string().nullable().optional(),
  createdAt: z.date(),
});

export const CreateRefundEventSchema = RefundEventSchema.omit({
  id: true,
  createdAt: true,
});

export type RefundEventDb = z.infer<typeof RefundEventDbSchema>; // DB 타입
export type RefundEvent = z.infer<typeof RefundEventSchema>; // 비즈니스 로직 타입
export type CreateRefundEvent = z.infer<typeof CreateRefundEventSchema>;

/* ------------------------------------------------------------------
 * 3️⃣ Drizzle relations
 * ----------------------------------------------------------------*/

// DB에서 받는 실제 타입 (decimal은 string)
export const PaymentEventDbSchema = z.object({
  id: id26,
  invoiceId: z.number().int().nonnegative(),
  paymentMethodId: id26,
  amount: z.string(), // DB decimal은 string
  status: z.enum(['REQUESTED', 'SUCCESS', 'FAILED', 'DUPLICATE_ATTEMPT']),
  pgTransactionId: z.string().max(255).nullable().optional(),
  pgResponse: z.string().nullable().optional(),
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN']),
  createdAt: z.date(),
});

// 비즈니스 로직에서 사용하는 타입 (amount는 number)
export const PaymentEventSchema = z.object({
  id: id26,
  invoiceId: z.number().int().nonnegative(),
  paymentMethodId: id26,
  amount: z.number().positive(), // 비즈니스 로직에서는 number
  status: z.enum(['REQUESTED', 'SUCCESS', 'FAILED', 'DUPLICATE_ATTEMPT']),
  pgTransactionId: z.string().max(255).nullable().optional(),
  pgResponse: z.string().nullable().optional(),
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN']),
  createdAt: z.date(),
});

export const CreatePaymentEventSchema = PaymentEventSchema.omit({
  id: true,
  createdAt: true,
});
