// apps/channel-adapter/scripts/lib/error-classifier.ts
import type { PimMedusaSyncService } from '../../src/adapters/medusa/pim-medusa-sync.service';
import type { PimProductSnapshot } from '../../src/types';

export type ErrorType =
  | 'validation_error'    // Snapshot validation failed (DON'T retry)
  | 'medusa_api_error'    // Medusa API error (retry with backoff)
  | 'network_error'       // Timeout/connection issues (retry with backoff)
  | 'db_error'            // Database operation failed (retry once)
  | 'unknown';            // Unexpected error (retry cautiously)

export interface SyncResult {
  success: boolean;
  masterId: string;
  medusaProductId?: string;
  action?: 'created' | 'updated' | 'skipped' | 'unpublished';
  error?: string;
}

/**
 * Classify error into specific type
 */
export function classifyError(error: any): ErrorType {
  // Validation errors (don't retry)
  if (error.name === 'ValidationError') {
    return 'validation_error';
  }

  // Check error message for validation keywords
  if (error.message?.toLowerCase().includes('validation')) {
    return 'validation_error';
  }

  // Medusa API errors (retry with backoff)
  if (error.response?.status) {
    return 'medusa_api_error';
  }

  // Network errors (retry with backoff)
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
    return 'network_error';
  }

  // Check error message for network keywords
  if (error.message?.toLowerCase().includes('timeout') ||
      error.message?.toLowerCase().includes('connection')) {
    return 'network_error';
  }

  // Database errors (retry once)
  if (error.message?.toLowerCase().includes('database') ||
      error.message?.toLowerCase().includes('query')) {
    return 'db_error';
  }

  return 'unknown';
}

/**
 * Determine if error should be retried
 */
export function shouldRetry(errorType: ErrorType): boolean {
  // Don't retry validation errors
  return errorType !== 'validation_error';
}

/**
 * Calculate retry delay based on attempt number and error type
 *
 * Strategies:
 * - validation_error: No retry (0ms)
 * - network_error: Exponential backoff with base 1.5 (2s, 3s, 4.5s)
 * - medusa_api_error: Exponential backoff with base 2 (2s, 4s, 8s)
 * - db_error: Linear backoff (2s, 4s, 6s)
 * - unknown: Linear backoff (2s, 4s, 6s)
 */
export function getRetryDelay(attempt: number, errorType: ErrorType): number {
  const baseDelay = 2000; // 2 seconds

  if (errorType === 'validation_error') {
    return 0; // No retry
  }

  if (errorType === 'network_error') {
    // Exponential backoff: 2s, 3s, 4.5s, 6.75s
    return Math.floor(baseDelay * Math.pow(1.5, attempt - 1));
  }

  if (errorType === 'medusa_api_error') {
    // Exponential backoff: 2s, 4s, 8s, 16s
    return baseDelay * Math.pow(2, attempt - 1);
  }

  // Linear backoff for db_error and unknown
  return baseDelay * attempt;
}

/**
 * Sync product with automatic retry logic
 *
 * @param snapshot Product snapshot to sync
 * @param syncService PimMedusaSyncService instance
 * @param maxRetries Maximum number of retry attempts (default: 3)
 * @returns SyncResult
 * @throws Error if all retries fail or validation error occurs
 */
export async function syncWithRetry(
  snapshot: PimProductSnapshot,
  syncService: PimMedusaSyncService,
  maxRetries: number = 3
): Promise<SyncResult> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Log attempt
      if (attempt > 1) {
        console.log(`  🔄 Retry attempt ${attempt}/${maxRetries} for ${snapshot.masterId}`);
      }

      // Call syncFromSnapshot method
      const result = await syncService.syncFromSnapshot(snapshot);

      // Success
      if (result.success) {
        if (attempt > 1) {
          console.log(`  ✅ Succeeded on retry ${attempt} for ${snapshot.masterId}`);
        }
        return result;
      }

      // If success=false but no error thrown, return as-is
      return result;

    } catch (error: any) {
      lastError = error;
      const errorType = classifyError(error);

      // Log error
      console.error(
        `  ⚠️  Attempt ${attempt} failed for ${snapshot.masterId}: ${error.message} (${errorType})`
      );

      // Don't retry validation errors
      if (!shouldRetry(errorType)) {
        console.error(`  ❌ Validation error, skipping retries for ${snapshot.masterId}`);
        throw error;
      }

      // If this was the last attempt, throw
      if (attempt >= maxRetries) {
        break;
      }

      // Calculate delay and wait
      const delay = getRetryDelay(attempt, errorType);
      console.log(`  ⏳ Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries failed
  const finalError = new Error(
    `Failed after ${maxRetries} attempts: ${lastError?.message}`
  );
  finalError.stack = lastError?.stack;
  throw finalError;
}

/**
 * Format error for logging
 */
export function formatError(error: any, errorType: ErrorType): string {
  const parts: string[] = [];

  parts.push(`Type: ${errorType}`);

  if (error.response?.status) {
    parts.push(`Status: ${error.response.status}`);
  }

  if (error.response?.data?.message) {
    parts.push(`API Message: ${error.response.data.message}`);
  }

  parts.push(`Message: ${error.message}`);

  return parts.join(' | ');
}
