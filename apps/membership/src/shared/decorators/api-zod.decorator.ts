/**
 * Zod 스키마를 Swagger 문서로 변환하는 간단한 데코레이터
 */
import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiResponse } from '@nestjs/swagger';
import type { ZodSchema } from 'zod';

/**
 * Zod 스키마를 기반으로 API 문서를 자동 생성하는 데코레이터
 * 
 * @param schema - Zod 스키마
 * @param options - 추가 옵션
 */
export function ApiZodBody(schema: ZodSchema, options?: { description?: string }) {
  return applyDecorators(
    ApiBody({
      description: options?.description || 'Request body',
      schema: {
        type: 'object',
        description: 'Generated from Zod schema',
      },
    })
  );
}

/**
 * Zod 스키마를 기반으로 응답 문서를 자동 생성하는 데코레이터
 * 
 * @param status - HTTP 상태 코드
 * @param schema - Zod 스키마
 * @param options - 추가 옵션
 */
export function ApiZodResponse(
  status: number,
  schema: ZodSchema,
  options?: { description?: string }
) {
  return applyDecorators(
    ApiResponse({
      status,
      description: options?.description || `Response with status ${status}`,
      schema: {
        type: 'object',
        description: 'Generated from Zod schema',
      },
    })
  );
}