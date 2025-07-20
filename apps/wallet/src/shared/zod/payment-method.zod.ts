import { z } from 'zod';
import { AmountSchema } from './shared.zod';
import {
  paymentMethod as paymentMethodTable,
  batchCmsMethod as batchCmsMethodTable,
} from '../schemas/schema';

// =================================================================
// 💳 Payment Method Domain (Namespace + Drizzle Types)
// =================================================================

// Validation schemas
const create = z.object({
  userId: z.string().max(64),
  methodType: z.enum(['CARD', 'BANK_ACCOUNT', 'BNPL', 'REWARD_POINT']),
  methodName: z.string().max(64),
  isDefault: z.boolean().default(false),
  institutionCode: z.string().max(32),
});

const update = create.partial();

const verifyStatus = z.object({
  status: z.enum(['ACTIVE', 'FAILED']),
});

const createBatchCms = z.object({
  hmsMemberId: z.string().max(64),
  hmsCustId: z.string().max(64).default('default-cust'),
  creditLimit: AmountSchema,
  approvedLimit: AmountSchema,
  billingCycleDay: z.number().int().min(1).max(31),
  hmsMetadata: z.string().optional(),
  termsUrl: z.string().url().optional(),
});

// Export namespaces (no PaymentMethod prefix - file already indicates domain)
export type Method = {
  Select: typeof paymentMethodTable.$inferSelect;
  Insert: typeof paymentMethodTable.$inferInsert;
  Create: z.infer<typeof create>;
  Update: z.infer<typeof update>;
  VerifyStatus: z.infer<typeof verifyStatus>;
};

export type BatchCms = {
  Select: typeof batchCmsMethodTable.$inferSelect;
  Insert: typeof batchCmsMethodTable.$inferInsert;
  Create: z.infer<typeof createBatchCms>;
};

// Legacy type aliases for backward compatibility
export type PaymentMethod = Method['Select'];
export type CreatePaymentMethodPayload = Method['Create'];
export type UpdatePaymentMethodPayload = Method['Update'];
export type VerifyPaymentMethodStatusPayload = Method['VerifyStatus'];
export type BatchCmsMethod = BatchCms['Select'];
export type CreateBatchCmsMethodPayload = BatchCms['Create'];

// Export validation schemas
export { create, update, verifyStatus, createBatchCms };
