import { Logger } from '@nestjs/common';

/**
 * 재시도 정책 옵션
 */
export interface RetryPolicyOptions {
  /** 최대 재시도 횟수 */
  maxRetries: number;
  /** 재시도 간격 (밀리초) - 지수백오프 패턴 */
  backoffMs: readonly number[];
  /** DLQ 토픽명 (선택사항) */
  dlqTopic?: string;
  /** 재시도 가능한 에러 패턴 (정규식) */
  retryableErrorPatterns?: RegExp[];
  /** 재시도 불가능한 에러 패턴 (정규식) */
  nonRetryableErrorPatterns?: RegExp[];
}

/**
 * 기본 재시도 정책 설정
 */
export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicyOptions> = {
  maxRetries: 3,
  backoffMs: [1000, 5000, 30000], // 1초, 5초, 30초
  retryableErrorPatterns: [
    /timeout/i,
    /network/i,
    /connection/i,
    /temporary/i,
    /rate.*limit/i,
  ],
  nonRetryableErrorPatterns: [
    /unauthorized/i,
    /forbidden/i,
    /not.*found/i,
    /bad.*request/i,
    /invalid/i,
  ],
};

/**
 * 재시도 정책 데코레이터
 *
 * 메서드 실행 시 실패하면 지정된 정책에 따라 재시도를 수행합니다.
 * 최대 재시도 횟수를 초과하면 DLQ로 전송하거나 에러를 던집니다.
 */
export function RetryPolicy(options: Partial<RetryPolicyOptions> = {}) {
  const config: RetryPolicyOptions = { ...DEFAULT_RETRY_POLICY, ...options };
  const logger = new Logger('RetryPolicy');

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const methodName = `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
          const result = await originalMethod.apply(this, args);

          // 성공 시 재시도 횟수가 0보다 크면 복구 로그 출력
          if (attempt > 0) {
            logger.log(`✅ [${methodName}] ${attempt}번째 재시도에서 성공`);
          }

          return result;
        } catch (error) {
          lastError = error as Error;

          // 재시도 가능한 에러인지 확인
          if (!isRetryableError(lastError, config)) {
            logger.warn(
              `🚫 [${methodName}] 재시도 불가능한 에러: ${lastError.message}`,
            );
            throw lastError;
          }

          // 최대 재시도 횟수 초과 확인
          if (attempt >= config.maxRetries) {
            logger.error(
              `❌ [${methodName}] 최대 재시도 횟수 초과 (${config.maxRetries}회): ${lastError.message}`,
            );

            // DLQ로 전송 시도
            if (
              config.dlqTopic &&
              typeof (this as any).sendToDLQ === 'function'
            ) {
              try {
                await (this as any).sendToDLQ(
                  config.dlqTopic,
                  args[0],
                  lastError,
                  attempt,
                );
                logger.warn(
                  `📤 [${methodName}] DLQ로 전송 완료: ${config.dlqTopic}`,
                );
              } catch (dlqError: any) {
                logger.error(
                  `❌ [${methodName}] DLQ 전송 실패: ${dlqError.message}`,
                );
              }
            }

            throw lastError;
          }

          // 재시도 지연 계산 및 로깅
          const delay = getBackoffDelay(config.backoffMs as number[], attempt);
          logger.warn(
            `⏳ [${methodName}] ${attempt + 1}/${config.maxRetries}번째 재시도 (${delay}ms 후): ${lastError.message}`,
          );

          // 지연 후 재시도
          await sleep(delay);
        }
      }

      // 안전장치
      throw lastError ?? new Error(`[${methodName}] Unknown error`);
    };

    return descriptor;
  };
}

/**
 * 에러가 재시도 가능한지 판단
 */
function isRetryableError(error: Error, config: RetryPolicyOptions): boolean {
  const errorMessage = (error.message ?? '').toLowerCase();

  // 재시도 불가능한 패턴 먼저 확인
  if (config.nonRetryableErrorPatterns?.some((p) => p.test(errorMessage))) {
    return false;
  }

  // 재시도 가능한 패턴 확인
  if (config.retryableErrorPatterns?.some((p) => p.test(errorMessage))) {
    return true;
  }

  // 기본적으로 재시도 가능 (보수적 접근)
  return true;
}

/**
 * 지수백오프 대기 시간 계산
 */
function getBackoffDelay(backoffs: number[], attempt: number): number {
  const index = Math.min(attempt, backoffs.length - 1);
  return backoffs[index];
}

/**
 * 지정된 시간만큼 대기
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 채널별 재시도 정책 프리셋
 */
export const CHANNEL_RETRY_POLICIES = {
  NAVER: {
    maxRetries: 3,
    backoffMs: [2000, 10000, 60000] as const, // ✅ readonly 배열 허용
    dlqTopic: 'naver.dlq',
    retryableErrorPatterns: [
      /rate.*limit/i,
      /too.*many.*requests/i,
      /timeout/i,
      /connection/i,
    ] as const,
    nonRetryableErrorPatterns: [
      /unauthorized/i,
      /invalid.*token/i,
      /not.*found/i,
    ] as const,
  } satisfies Partial<RetryPolicyOptions>, // ✅ satisfies로 강제 형변환
  COUPANG: {
    maxRetries: 5,
    backoffMs: [1000, 3000, 10000, 30000, 120000] as const,
    dlqTopic: 'coupang.dlq',
    retryableErrorPatterns: [
      /rate.*limit/i,
      /quota.*exceeded/i,
      /timeout/i,
      /connection/i,
      /temporary/i,
    ] as const,
    nonRetryableErrorPatterns: [
      /unauthorized/i,
      /forbidden/i,
      /invalid.*request/i,
      /not.*found/i,
    ] as const,
  } satisfies Partial<RetryPolicyOptions>,
  GENERAL: DEFAULT_RETRY_POLICY,
} as const;

/**
 * 채널별 재시도 정책을 적용하는 편의 데코레이터들
 */
export const NaverRetryPolicy = () =>
  RetryPolicy(CHANNEL_RETRY_POLICIES.NAVER as Partial<RetryPolicyOptions>);
export const CoupangRetryPolicy = () =>
  RetryPolicy(CHANNEL_RETRY_POLICIES.COUPANG as Partial<RetryPolicyOptions>);
export const GeneralRetryPolicy = () =>
  RetryPolicy(CHANNEL_RETRY_POLICIES.GENERAL);
