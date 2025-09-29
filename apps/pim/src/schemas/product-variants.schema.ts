import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// 기본 스키마들
const VariantStatusSchema = z
  .enum(['active', 'inactive'] as const)
  .describe('제품 변형 상태');

// 요청 스키마들
export const UpdateProductVariantSchema = z.object({
  name: z
    .string()
    .min(1, '변형명은 필수입니다')
    .optional()
    .describe('제품 변형 이름'),
  sku: z.string().optional().describe('SKU 코드'),
  attributes: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('변형 속성 (색상, 사이즈 등)'),
  images: z
    .array(z.string().url('유효한 URL이어야 합니다'))
    .optional()
    .describe('변형별 이미지 URL 배열'),
  status: VariantStatusSchema.optional().describe('변형 상태'),
  weight: z
    .number()
    .positive('무게는 0보다 커야 합니다')
    .optional()
    .describe('무게 (g)'),
  dimensions: z
    .object({
      length: z.number().positive().describe('길이 (cm)'),
      width: z.number().positive().describe('너비 (cm)'),
      height: z.number().positive().describe('높이 (cm)'),
    })
    .optional()
    .describe('치수 정보'),
});

export const UpdateVariantBulkSchema = z.object({
  variantIds: z
    .array(z.string())
    .min(1, '최소 1개 이상의 변형이 필요합니다')
    .describe('변형 ID 목록'),
  updates: z
    .object({
      status: z.string().optional().describe('상태'),
      displayOrder: z.number().optional().describe('표시 순서'),
      images: z.array(z.string()).optional().describe('이미지 목록'),
    })
    .describe('수정할 정보'),
});

export const UpdateVariantStatusSchema = z.object({
  status: VariantStatusSchema.describe('새로운 변형 상태'),
});

// 응답 스키마들 - 기존 ProductVariant 타입과 일치
export const ProductVariantSchema = z.object({
  id: z.uuid().describe('제품 변형 ID (UUID 형식)'),
  masterId: z.uuid().describe('제품 마스터 ID (UUID 형식)'),
  variantName: z.string().nullable().describe('변형명'),
  images: z.any().describe('변형 이미지 (JSONB)'),
  priceAdjustment: z.number().nullable().describe('가격 조정'),
  displayOrder: z.number().nullable().describe('표시 순서'),
  status: z.string().nullable().describe('변형 상태'),
  isDefault: z.boolean().nullable().describe('기본 변형 여부'),
  createdAt: z.iso.datetime().nullable().describe('생성일시'),
  updatedAt: z.iso.datetime().nullable().describe('수정일시'),
});

export const VariantWithPriceSchema = ProductVariantSchema.extend({
  price: z.number().describe('계산된 가격'),
  optionValues: z.array(z.any()).describe('옵션 값들'),
});

export const VariantListResponseSchema = z.object({
  data: z.array(VariantWithPriceSchema).describe('제품 변형 목록'),
  total: z.number().int().min(0).describe('전체 아이템 수'),
  page: z.number().int().min(1).describe('현재 페이지 번호'),
  limit: z.number().int().min(1).describe('페이지당 아이템 수'),
});

export const VariantUpdateResponseSchema = z.object({
  success: z.boolean().describe('수정 성공 여부'),
  data: VariantWithPriceSchema.describe('수정된 제품 변형 정보'),
});

export const VariantPriceResponseSchema = z.object({
  variantId: z.uuid().describe('제품 변형 ID'),
  price: z.number().describe('계산된 가격'),
});

// DTO 클래스들
export class UpdateProductVariantDto extends createZodDto(
  UpdateProductVariantSchema,
) {}
export class UpdateVariantBulkDto extends createZodDto(
  UpdateVariantBulkSchema,
) {}
export class UpdateVariantStatusDto extends createZodDto(
  UpdateVariantStatusSchema,
) {}
export class ProductVariantDto extends createZodDto(ProductVariantSchema) {}
export class VariantWithPriceDto extends createZodDto(VariantWithPriceSchema) {}
export class VariantListResponseDto extends createZodDto(
  VariantListResponseSchema,
) {}
export class VariantUpdateResponseDto extends createZodDto(
  VariantUpdateResponseSchema,
) {}
export class VariantPriceResponseDto extends createZodDto(
  VariantPriceResponseSchema,
) {}
