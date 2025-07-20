// shared.zod.ts - Common utilities for all wallet schemas
import { z } from 'zod';

// ⛳ 1. 공통 유틸리티 및 Enum (내부용)
// ────────────────────────────────────────────────────────────────

/**
 * ID validation schemas
 * - ULID: 26 characters for internal operations (payment methods, transactions, events)
 * - TSID: 21 characters for batch CMS operations (HMS integration, member IDs)
 */
export const ID = {
  ULID: z.string().length(26, 'ULID must be 26 characters long'),
  TSID: z.string().length(21, 'TSID must be 21 characters long'),
};

/**
 * Amount validation schema
 * - Unified number type for all monetary amounts
 * - Positive number validation
 */
export const AmountSchema = z.number().positive('Amount must be a positive number');
