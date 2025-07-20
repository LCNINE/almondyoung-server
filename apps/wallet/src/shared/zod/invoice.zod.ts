import { z } from 'zod';
import { AmountSchema } from './shared.zod';
import {
  invoice as invoiceTable,
  invoiceEvent as invoiceEventTable,
} from '../schemas/schema';

// =================================================================
// 📋 Invoice Domain (Namespace + Drizzle Types)
// =================================================================

// Validation schemas
const create = z.object({
  userId: z.string().max(64),
  invoiceType: z.string().max(32),
  amount: AmountSchema,
  currency: z.string().length(3),
  dueAt: z.date().nullable().optional(),
});

const updateStatus = z.object({
  status: z.enum([
    'ISSUED',
    'PAID',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'CANCELLED',
    'EXPIRED',
    'OVERDUE',
    'FAILED',
  ]),
  reason: z.string().optional(),
});

// Export namespaces (no Invoice prefix - file already indicates domain)
export type Invoice = {
  Select: typeof invoiceTable.$inferSelect;
  Insert: typeof invoiceTable.$inferInsert;
  Create: z.infer<typeof create>;
  UpdateStatus: z.infer<typeof updateStatus>;
  WithEvents: Invoice['Select'] & { events: Event['Select'][] };
};

export type Event = {
  Select: typeof invoiceEventTable.$inferSelect;
  Insert: typeof invoiceEventTable.$inferInsert;
};

// Export validation schemas
export { create, updateStatus };
