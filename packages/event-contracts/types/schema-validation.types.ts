/**
 * Schema Validation Types
 *
 * Zod 기반 런타임 스키마 검증
 */

import { z } from 'zod';

/**
 * Zod 스키마 타입
 */
export type ZodSchema<T = any> = z.ZodType<T>;

/**
 * 스키마 검증 에러
 */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: z.ZodIssue[],
    public readonly payload: unknown,
  ) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

/**
 * 스키마 검증 옵션
 */
export interface SchemaValidationOptions {
  /**
   * 발행 시 스키마 검증 활성화
   * @default true
   */
  validateOnPublish?: boolean;

  /**
   * 구독 시 스키마 검증 활성화
   * @default true
   */
  validateOnConsume?: boolean;

  /**
   * 스키마 검증 실패 시 에러를 던질지 여부
   * false인 경우 경고 로그만 출력
   * @default true
   */
  throwOnValidationError?: boolean;
}

/**
 * 기본 스키마 검증 옵션
 */
export const DEFAULT_SCHEMA_VALIDATION_OPTIONS: Required<SchemaValidationOptions> =
  {
    validateOnPublish: true,
    validateOnConsume: true,
    throwOnValidationError: true,
  };

/**
 * 스키마 검증 결과
 */
export interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: z.ZodIssue[];
}

