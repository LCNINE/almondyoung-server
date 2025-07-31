import {
    paymentSessions,
    paymentLocks,
    paymentSessionEvents,
    PaymentSessionStatus,
    PaymentLockStatus,
    PaymentSessionEventType,
    
} from '../../shared/schemas/schema';

// Drizzle inferred types for database operations
export type PaymentSession = typeof paymentSessions.$inferSelect;
export type PaymentSessionInsert = typeof paymentSessions.$inferInsert;

export type PaymentLock = typeof paymentLocks.$inferSelect;
export type PaymentLockInsert = typeof paymentLocks.$inferInsert;

export type PaymentSessionEvent = typeof paymentSessionEvents.$inferSelect;
export type PaymentSessionEventInsert = typeof paymentSessionEvents.$inferInsert;

// Re-export types for convenience
export type {
    PaymentSessionStatus,
    PaymentLockStatus,
    PaymentSessionEventType,

};

// Helper types for better null safety and query results
export type PaymentSessionQueryResult = PaymentSession | null;
export type PaymentLockQueryResult = PaymentLock | null;
export type PaymentSessionEventQueryResult = PaymentSessionEvent | null;

// Array types for list operations
export type PaymentSessionList = PaymentSession[];
export type PaymentLockList = PaymentLock[];
export type PaymentSessionEventList = PaymentSessionEvent[];