/**
 * Retry Policy Types
 *
 * 이벤트 핸들러의 재시도 정책 정의
 */

export const RETRY_POLICY_METADATA = 'RETRY_POLICY_METADATA';
export const DISABLE_DLQ_METADATA = 'DISABLE_DLQ_METADATA';

/**
 * 백오프 전략
 */
export type BackoffStrategy = 'fixed' | 'exponential' | 'linear';

/**
 * 재시도 정책
 */
export interface RetryPolicyConfig {
  /**
   * 최대 재시도 횟수
   * @default 3
   */
  maxRetries?: number;

  /**
   * 백오프 전략
   * - fixed: 고정 간격
   * - exponential: 지수 백오프 (1s, 2s, 4s, 8s...)
   * - linear: 선형 증가 (1s, 2s, 3s, 4s...)
   * @default 'exponential'
   */
  backoff?: BackoffStrategy;

  /**
   * 초기 백오프 시간 (ms)
   * @default 1000
   */
  initialDelayMs?: number;

  /**
   * 최대 백오프 시간 (ms)
   * @default 30000
   */
  maxDelayMs?: number;

  /**
   * 재시도할 에러 타입 (지정하지 않으면 모든 에러 재시도)
   */
  retryableErrors?: Array<new (...args: any[]) => Error>;

  /**
   * 재시도하지 않을 에러 타입
   */
  nonRetryableErrors?: Array<new (...args: any[]) => Error>;
}

/**
 * 재시도 컨텍스트 (내부 사용)
 */
export interface RetryContext {
  attemptNumber: number;
  lastError?: Error;
  attemptHistory: Array<{
    attemptedAt: string;
    error: string;
  }>;
}

/**
 * 기본 재시도 정책
 */
export const DEFAULT_RETRY_POLICY: Required<
  Omit<RetryPolicyConfig, 'retryableErrors' | 'nonRetryableErrors'>
> = {
  maxRetries: 3,
  backoff: 'exponential',
  initialDelayMs: 1000,
  maxDelayMs: 30000,
};

