// apps/channel-adapter/scripts/lib/error-classifier.ts
import type { PimMedusaSyncService } from '../../src/adapters/medusa/pim-medusa-sync.service';
import type { PimProductSnapshot } from '../../src/types';

export type ErrorType =
  | 'validation_error' // Snapshot validation failed (DON'T retry)
  | 'medusa_api_error' // Medusa API error (retry with backoff)
  | 'service_unavailable' // 502/503 — 서버 과부하. 길게 기다렸다 재시도
  | 'network_error' // Timeout/connection issues (retry with backoff)
  | 'db_error' // Database operation failed (retry once)
  | 'unknown'; // Unexpected error (retry cautiously)

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

  // Check error message for validation keywords. PIM 검증 메시지는 'validation' 키워드를
  // 안 쓰는 경우가 있어(예: "PIM snapshot must have at least one variant") 명시적 패턴 추가.
  const msg = error.message?.toLowerCase() || '';
  if (msg.includes('validation') || msg.includes('pim snapshot') || msg.includes('snapshot must')) {
    return 'validation_error';
  }

  // 503/502 = 서버 과부하. 매우 길게 기다렸다 재시도해야 cascade 가 풀린다.
  const status = error.response?.status ?? error.status;
  const lowerMsg = (error.message || '').toLowerCase();
  const is5xxOverload =
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lowerMsg.includes('service temporarily unavailable') ||
    lowerMsg.includes('service unavailable') ||
    lowerMsg.includes('bad gateway') ||
    lowerMsg.includes('gateway timeout');
  if (is5xxOverload) {
    return 'service_unavailable';
  }

  // Medusa API errors (retry with backoff). Medusa SDK 의 FetchError 는 `.status` 를
  // 직접 노출하므로 양쪽 모두 본다.
  if (error.response?.status || typeof error.status === 'number') {
    return 'medusa_api_error';
  }

  // Network errors (retry with backoff)
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
    return 'network_error';
  }

  // Check error message for network keywords
  if (error.message?.toLowerCase().includes('timeout') || error.message?.toLowerCase().includes('connection')) {
    return 'network_error';
  }

  // Database errors (retry once)
  if (error.message?.toLowerCase().includes('database') || error.message?.toLowerCase().includes('query')) {
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
 * - service_unavailable (502/503/504): 길게 — 15s, 30s, 60s. 서버가 회복할 시간 확보.
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

  if (errorType === 'service_unavailable') {
    // 15s, 30s, 60s — 5xx 캐스케이드 풀어주려면 짧게 재시도하면 안 됨.
    return 15000 * Math.pow(2, attempt - 1);
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
  maxRetries: number = 3,
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
      console.error(`  ⚠️  Attempt ${attempt} failed for ${snapshot.masterId}: ${error.message} (${errorType})`);

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
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // All retries failed
  const finalError = new Error(`Failed after ${maxRetries} attempts: ${lastError?.message}`);
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
