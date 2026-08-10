/**
 * Schema Validation Utility
 *
 * Zod 스키마 검증 유틸리티
 */

import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { ZodSchema, SchemaValidationError, ValidationResult } from '@packages/event-contracts/types';

const logger = new Logger('SchemaValidation');

/**
 * 스키마로 데이터 검증
 *
 * @param schema - Zod 스키마
 * @param data - 검증할 데이터
 * @returns 검증 결과
 */
export function validateSchema<T>(schema: ZodSchema<T>, data: unknown): ValidationResult<T> {
  try {
    const result = schema.safeParse(data);

    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    } else {
      return {
        success: false,
        errors: result.error.issues,
      };
    }
  } catch (error) {
    logger.error({
      msg: 'Schema validation threw unexpected error',
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      errors: [
        {
          code: 'custom',
          path: [],
          message: error instanceof Error ? error.message : 'Unknown validation error',
        },
      ],
    };
  }
}

/**
 * 스키마 검증 또는 에러 던지기
 *
 * @param schema - Zod 스키마
 * @param data - 검증할 데이터
 * @param context - 에러 메시지에 포함할 컨텍스트
 * @returns 검증된 데이터
 * @throws SchemaValidationError
 */
export function validateSchemaOrThrow<T>(schema: ZodSchema<T>, data: unknown, context?: string): T {
  const result = validateSchema(schema, data);

  if (!result.success) {
    const errorMessage = context ? `Schema validation failed for ${context}` : 'Schema validation failed';

    throw new SchemaValidationError(errorMessage, result.errors!, data);
  }

  return result.data!;
}

/**
 * 스키마 검증 에러 포맷팅
 */
export function formatValidationErrors(errors: z.ZodIssue[]): string {
  return errors
    .map((error) => {
      const path = error.path.length > 0 ? error.path.join('.') : 'root';
      return `  - ${path}: ${error.message}`;
    })
    .join('\n');
}

/**
 * 스키마 검증 에러 로깅.
 *
 * ⚠️ **호출자가 0곳이다.** 그 상태를 유지할 것 — `payload` 를 통째로 싣기 때문이다. 로그 필드는
 * 이제 Loki 까지 나가므로(아래 log-shape 스펙 참조) 이 함수를 배선하는 순간 이벤트 payload 전문이
 * 로그 백엔드에 적재된다. 이 레포는 계약 payload 에 이메일·주소를 담는 이벤트가 있다.
 * 진단이 필요하면 `formatValidationErrors`(경로+사유만) 를 쓴다.
 */
export function logValidationError(context: string, errors: z.ZodIssue[], payload: unknown): void {
  logger.error({
    msg: `❌ ${context}`,
    errors: formatValidationErrors(errors),
    payload: JSON.stringify(payload, null, 2),
  });
}

/**
 * Type guard: ZodSchema인지 확인
 */
export function isZodSchema(value: unknown): value is ZodSchema {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    '_def' in value &&
    'parse' in value &&
    'safeParse' in value
  );
}
