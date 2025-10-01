/**
 * Retry Utility
 *
 * 재시도 로직 및 백오프 계산
 */

import {
  RetryPolicyConfig,
  RetryContext,
  BackoffStrategy,
  DEFAULT_RETRY_POLICY,
} from './retry-policy.types';

/**
 * 재시도 정책에 기본값 적용
 */
export function normalizeRetryPolicy(
  config: RetryPolicyConfig,
): Required<Omit<RetryPolicyConfig, 'retryableErrors' | 'nonRetryableErrors'>> &
  Pick<RetryPolicyConfig, 'retryableErrors' | 'nonRetryableErrors'> {
  return {
    maxRetries: config.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
    backoff: config.backoff ?? DEFAULT_RETRY_POLICY.backoff,
    initialDelayMs: config.initialDelayMs ?? DEFAULT_RETRY_POLICY.initialDelayMs,
    maxDelayMs: config.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
    retryableErrors: config.retryableErrors,
    nonRetryableErrors: config.nonRetryableErrors,
  };
}

/**
 * 에러가 재시도 가능한지 판단
 */
export function isRetryableError(
  error: Error,
  policy: RetryPolicyConfig,
): boolean {
  // nonRetryableErrors에 포함되면 재시도하지 않음
  if (policy.nonRetryableErrors) {
    for (const ErrorClass of policy.nonRetryableErrors) {
      if (error instanceof ErrorClass) {
        return false;
      }
    }
  }

  // retryableErrors가 지정되어 있으면 해당 에러만 재시도
  if (policy.retryableErrors) {
    for (const ErrorClass of policy.retryableErrors) {
      if (error instanceof ErrorClass) {
        return true;
      }
    }
    return false;
  }

  // 기본: 모든 에러 재시도
  return true;
}

/**
 * 백오프 지연 시간 계산
 *
 * @param attemptNumber - 시도 횟수 (1부터 시작)
 * @param strategy - 백오프 전략
 * @param initialDelayMs - 초기 지연 시간
 * @param maxDelayMs - 최대 지연 시간
 * @returns 지연 시간 (ms)
 */
export function calculateBackoffDelay(
  attemptNumber: number,
  strategy: BackoffStrategy,
  initialDelayMs: number,
  maxDelayMs: number,
): number {
  let delay: number;

  switch (strategy) {
    case 'fixed':
      delay = initialDelayMs;
      break;

    case 'linear':
      delay = initialDelayMs * attemptNumber;
      break;

    case 'exponential':
      delay = initialDelayMs * Math.pow(2, attemptNumber - 1);
      break;

    default:
      delay = initialDelayMs;
  }

  // 최대 지연 시간 제한
  return Math.min(delay, maxDelayMs);
}

/**
 * 지정된 시간만큼 대기
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 재시도 컨텍스트 초기화
 */
export function createRetryContext(): RetryContext {
  return {
    attemptNumber: 0,
    attemptHistory: [],
  };
}

/**
 * 재시도 컨텍스트 업데이트
 */
export function updateRetryContext(
  context: RetryContext,
  error: Error,
): RetryContext {
  return {
    attemptNumber: context.attemptNumber + 1,
    lastError: error,
    attemptHistory: [
      ...context.attemptHistory,
      {
        attemptedAt: new Date().toISOString(),
        error: error.message,
      },
    ],
  };
}

