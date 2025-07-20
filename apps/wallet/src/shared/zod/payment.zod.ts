import { z } from 'zod';
import { ID, AmountSchema } from './shared.zod';
import {
  paymentEvents as paymentEventsTable,
  refundEvents as refundEventsTable,
} from '../schemas/schema';

// =================================================================
// 💰 Payment Domain (Namespace + Drizzle Types)
// =================================================================

// Validation schemas
const request = z.object({
  invoiceId: z.string().max(64),
  paymentMethodId: ID.ULID,
  amount: AmountSchema,
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN', 'SYSTEM']),
  metadata: z.record(z.any()).optional(), // Service layer accepts object
});

const requestDb = z.object({
  invoiceId: z.string().max(64),
  paymentMethodId: ID.ULID,
  amount: AmountSchema,
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN', 'SYSTEM']),
  metadata: z.string().nullable().optional(), // DB stores as JSON string
});

const authorize = z.object({
  id: ID.ULID,
  pgTransactionId: z.string().max(255).nullable().optional(),
  pgResponse: z.string().nullable().optional(),
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN', 'SYSTEM']),
});

const capture = z.object({
  id: ID.ULID,
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN', 'SYSTEM']),
});

const fail = z.object({
  id: ID.ULID,
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN', 'SYSTEM']),
  errorMessage: z.string().max(255).nullable().optional(),
});

const updateStatus = z.object({
  status: z.enum([
    'REQUESTED',
    'AUTHORIZED',
    'CAPTURED',
    'FAILED',
    'DUPLICATE_ATTEMPT',
  ]),
  reason: z.string().optional(),
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN', 'SYSTEM']),
});

// Export namespaces (no Payment prefix - file already indicates domain)
export type Event = {
  Select: typeof paymentEventsTable.$inferSelect;
  Insert: typeof paymentEventsTable.$inferInsert;
  Request: z.infer<typeof request>;
  RequestDb: z.infer<typeof requestDb>;
  Authorize: z.infer<typeof authorize>;
  Capture: z.infer<typeof capture>;
  Fail: z.infer<typeof fail>;
  UpdateStatus: z.infer<typeof updateStatus>;
};

export type Refund = {
  Select: typeof refundEventsTable.$inferSelect;
  Insert: typeof refundEventsTable.$inferInsert;
};

//
// Export validation schemas
export { request, requestDb, authorize, capture, fail, updateStatus };
