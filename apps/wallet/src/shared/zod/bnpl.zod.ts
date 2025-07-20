import { z } from 'zod';
import { ID, AmountSchema } from './shared.zod';
import {
  bnplAccount as bnplAccountTable,
  bnplActivationEvent as bnplActivationEventTable,
  bnplTransaction as bnplTransactionTable,
  settlementBatch as settlementBatchTable,
  settlementBatchItem as settlementBatchItemTable,
  settlementProcessEvent as settlementProcessEventTable,
} from '../schemas/schema';

// =================================================================
// 💳 BNPL Domain (Namespace + Drizzle Types)
// =================================================================

// Validation schemas
const createAccount = z.object({
  userId: z.string().max(64),
  paymentMethodId: ID.ULID,
  creditLimit: AmountSchema,
  approvedLimit: AmountSchema,
  billingCycleDay: z.number().int().min(1).max(31),
  termsUrl: z.string().url().optional(),
});

const updateAccountStatus = z.object({
  bnplAccountId: ID.TSID,
  status: z.enum(['ACTIVE', 'INACTIVE', 'OVERDUE', 'SUSPENDED']),
});

const paymentRequest = z.object({
  accountId: ID.TSID, // BNPL account ID uses TSID for batch CMS
  amount: AmountSchema,
  paymentMethodId: ID.ULID.optional(),
  invoiceId: z.string().max(64).optional(),
  description: z.string().max(255).optional(),
});

const paymentResult = z.object({
  success: z.boolean(),
  transactionId: ID.ULID.optional(),
  hmsTransactionId: z.string().optional(),
  paymentEventId: ID.ULID.optional(),
  amount: AmountSchema.optional(),
  newBalance: z.number().optional(),
  correlationId: ID.ULID,
  errorMessage: z.string().optional(),
});

const refundRequest = z.object({
  originalPaymentId: ID.ULID,
  refundAmount: AmountSchema,
  reason: z.string().min(5),
  requestedBy: z.string().optional(),
});

const refundResult = z.object({
  success: z.boolean(),
  refundId: ID.ULID.optional(),
  hmsRefundId: z.string().optional(),
  paymentEventId: ID.ULID.optional(),
  refundAmount: AmountSchema.optional(),
  newBalance: z.number().optional(),
  originalPaymentId: ID.ULID.optional(),
  correlationId: ID.ULID,
  errorMessage: z.string().optional(),
});

const createSettlementEvent = z.object({
  batchId: ID.ULID,
  batchItemId: ID.ULID.optional(),
  eventType: z.enum([
    'BATCH_STARTED',
    'ITEM_PROCESSING',
    'ITEM_AUTHORIZED',
    'ITEM_CAPTURED',
    'ITEM_FAILED',
    'BATCH_COMPLETED',
    'BATCH_FAILED',
  ]),
  status: z.enum(['PROCESSING', 'AUTHORIZED', 'CAPTURED', 'FAILED']),
  paymentEventId: ID.ULID.optional(),
  errorMessage: z.string().optional(),
  metadata: z.string().optional(),
  actor: z.enum(['SCHEDULER', 'ADMIN', 'SYSTEM', 'USER']).default('SCHEDULER'),
});

// Export namespaces (no Bnpl prefix - file already indicates domain)
export type Account = {
  Select: typeof bnplAccountTable.$inferSelect;
  Insert: typeof bnplAccountTable.$inferInsert;
  Create: z.infer<typeof createAccount>;
  UpdateStatus: z.infer<typeof updateAccountStatus>;
  WithBalance: Account['Select'] & { currentBalance: number };
};

export type ActivationEvent = {
  Select: typeof bnplActivationEventTable.$inferSelect;
  Insert: typeof bnplActivationEventTable.$inferInsert;
};

export type Transaction = {
  Select: typeof bnplTransactionTable.$inferSelect;
  Insert: typeof bnplTransactionTable.$inferInsert;
};

export type Payment = {
  Request: z.infer<typeof paymentRequest>;
  Result: z.infer<typeof paymentResult>;
};

export type Refund = {
  Request: z.infer<typeof refundRequest>;
  Result: z.infer<typeof refundResult>;
};

export type Ssettlement = {
  Batch: {
    Select: typeof settlementBatchTable.$inferSelect;
    Insert: typeof settlementBatchTable.$inferInsert;
  };
};

export type BatchItem = {
  Select: typeof settlementBatchItemTable.$inferSelect;
  Insert: typeof settlementBatchItemTable.$inferInsert;
  WithTransaction: BatchItem['Select'] & {
    bnplTransaction: Transaction['Select'];
  };
};

export type ProcessEvent = {
  Select: typeof settlementProcessEventTable.$inferSelect;
  Insert: typeof settlementProcessEventTable.$inferInsert;
  Create: z.infer<typeof createSettlementEvent>;
};

// Export validation schemas
export default {
  createAccount,
  updateAccountStatus,
  paymentRequest,
  paymentResult,
  refundRequest,
  refundResult,
  createSettlementEvent,
};
