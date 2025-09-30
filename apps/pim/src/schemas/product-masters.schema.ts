import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// 기본 스키마들
const PricingStrategySchema = z
  .enum(['option_based', 'variant_based'] as const)
  .describe('가격 전략 타입');

const ProductStatusSchema = z
  .enum(['active', 'inactive', 'draft'] as const)
  .describe('제품 상태');

// 요청 스키마들 - 기존 CreateMasterDto 인터페이스와 일치
export const CreateMasterSchema = z.object({
  name: z.string().min(1, '제품명은 필수입니다').describe('제품 마스터 이름'),
  description: z.string().optional().describe('제품 설명'),
  brand: z.string().optional().describe('브랜드명'),
  thumbnail: z.string().optional().describe('썸네일 이미지 URL'),
  basePrice: z.number().describe('기본 가격'),
  pricingStrategy: PricingStrategySchema.describe('가격 전략'),
  tags: z.array(z.string()).optional().describe('마케팅 태그'),
  images: z.array(z.string()).optional().describe('제품 이미지 URL 배열'),
  attributes: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('제품 속성 (키-값 쌍)'),
  seoTitle: z.string().optional().describe('SEO 제목'),
  seoDescription: z.string().optional().describe('SEO 설명'),
  seoKeywords: z.array(z.string()).optional().describe('SEO 키워드'),

  // 구매제한 필드들
  isWholesaleOnly: z.boolean().default(false).describe('도매회원 전용 여부'),
  isMembershipOnly: z.boolean().default(false).describe('멤버십회원 전용 여부'),
  // 특별 가격 필드들
  membershipPrice: z
    .number()
    .int('정수여야 합니다')
    .positive('양수여야 합니다')
    .optional()
    .describe('멤버십 전용 가격 (원 단위)'),
  wholesalePrice: z
    .number()
    .int('정수여야 합니다')
    .positive('양수여야 합니다')
    .optional()
    .describe('도매 전용 가격 (원 단위)'),

  // 옵션 정보
  optionGroups: z
    .array(
      z.object({
        name: z.string().describe('옵션 그룹명'),
        displayName: z.string().describe('옵션 그룹 표시명'),
        sortOrder: z.number().optional().describe('정렬 순서'),
        values: z
          .array(
            z.object({
              value: z.string().describe('옵션 값'),
              displayName: z.string().describe('옵션 값 표시명'),
              sortOrder: z.number().optional().describe('정렬 순서'),
              price: z.number().optional().describe('옵션별 가격'),
            }),
          )
          .describe('옵션 값들'),
      }),
    )
    .optional()
    .describe('옵션 그룹들'),

  // variant_based 전략용 품목별 가격
  variantPrices: z
    .record(z.string(), z.number())
    .optional()
    .describe('옵션 조합별 가격'),
});

export const UpdateProductMasterSchema = z.object({
  name: z
    .string()
    .min(1, '제품명은 필수입니다')
    .optional()
    .describe('제품 마스터 이름'),
  description: z.string().optional().describe('제품 설명'),
  categoryId: z
    .uuid('유효한 UUID 형식이어야 합니다')
    .optional()
    .describe('카테고리 ID (UUID 형식)'),
  brand: z.string().optional().describe('브랜드명'),
  basePrice: z
    .number()
    .positive('기본 가격은 0보다 커야 합니다')
    .optional()
    .describe('기본 가격'),
  images: z
    .array(z.string().url('유효한 URL이어야 합니다'))
    .optional()
    .describe('제품 이미지 URL 배열'),
  attributes: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('제품 속성 (키-값 쌍)'),
  status: ProductStatusSchema.optional().describe('제품 상태'),
});

export const ChangePricingStrategySchema = z.object({
  pricingStrategy: PricingStrategySchema.describe('새로운 가격 전략'),
  migrationData: z.any().optional().describe('마이그레이션 데이터 (선택사항)'),
});

// 응답 스키마들 - 기존 ProductMaster 타입과 일치 (categoryId 제거)
export const ProductMasterSchema = z.object({
  id: z.uuid().describe('제품 마스터 ID (UUID 형식)'),
  name: z.string().describe('제품 마스터 이름'),
  description: z.string().nullable().describe('제품 설명'),
  brand: z.string().nullable().describe('브랜드명'),
  basePrice: z.number().nullable().describe('기본 가격'),
  pricingStrategy: z.string().describe('가격 전략'),
  tags: z.array(z.string()).nullable().describe('마케팅 태그'),
  images: z.any().describe('제품 이미지 (JSONB)'),
  attributes: z.any().describe('제품 속성 (JSONB)'),
  seoTitle: z.string().nullable().describe('SEO 제목'),
  seoDescription: z.string().nullable().describe('SEO 설명'),
  seoKeywords: z.array(z.string()).nullable().describe('SEO 키워드'),
  status: z.string().nullable().describe('제품 상태'),
  // 구매제한 필드들
  isWholesaleOnly: z.boolean().nullable().describe('도매회원 전용 여부'),
  isMembershipOnly: z.boolean().nullable().describe('멤버십회원 전용 여부'),
  // 특별 가격 필드들
  membershipPrice: z.number().nullable().describe('멤버십 전용 가격'),
  wholesalePrice: z.number().nullable().describe('도매 전용 가격'),
  createdAt: z.iso.datetime().nullable().describe('생성일시'),
  updatedAt: z.iso.datetime().nullable().describe('수정일시'),
  createdBy: z.string().nullable().describe('생성자'),
  updatedBy: z.string().nullable().describe('수정자'),
});

export const MasterDetailSchema = ProductMasterSchema.extend({
  optionGroups: z
    .array(
      z.object({
        id: z.uuid().describe('옵션 그룹 ID'),
        name: z.string().describe('옵션 그룹명'),
        displayName: z.string().describe('옵션 그룹 표시명'),
        sortOrder: z.number().describe('정렬 순서'),
        isRequired: z.boolean().describe('필수 여부'),
        createdAt: z.iso.datetime().describe('생성일시'),
        updatedAt: z.iso.datetime().describe('수정일시'),
        values: z
          .array(
            z.object({
              id: z.uuid().describe('옵션 값 ID'),
              value: z.string().describe('옵션 값'),
              displayName: z.string().describe('옵션 값 표시명'),
              sortOrder: z.number().describe('정렬 순서'),
              isActive: z.boolean().describe('활성 여부'),
              createdAt: z.iso.datetime().describe('생성일시'),
              updatedAt: z.iso.datetime().describe('수정일시'),
            }),
          )
          .describe('옵션 값들'),
      }),
    )
    .describe('옵션 그룹들'),
  variants: z
    .array(
      z.object({
        id: z.uuid().describe('변형 ID'),
        masterId: z.uuid().describe('마스터 ID'),
        variantName: z.string().nullable().describe('변형명'),
        images: z.any().describe('변형 이미지'),
        priceAdjustment: z.number().nullable().describe('가격 조정'),
        displayOrder: z.number().nullable().describe('표시 순서'),
        status: z.string().nullable().describe('변형 상태'),
        isDefault: z.boolean().nullable().describe('기본 변형 여부'),
        createdAt: z.iso.datetime().nullable().describe('생성일시'),
        updatedAt: z.iso.datetime().nullable().describe('수정일시'),
        optionValues: z.array(z.any()).describe('옵션 값들'),
        price: z.number().optional().describe('계산된 가격'),
      }),
    )
    .describe('연결된 제품 변형 목록'),
  channelProducts: z
    .array(
      z.object({
        id: z.uuid().describe('채널 제품 ID'),
        masterId: z.uuid().describe('마스터 ID'),
        channelId: z.uuid().describe('채널 ID'),
        name: z.string().nullable().describe('채널별 제품명'),
        isActive: z.boolean().nullable().describe('활성 여부'),
        channelSpecificData: z.any().describe('채널별 특화 데이터'),
        createdAt: z.iso.datetime().nullable().describe('생성일시'),
        updatedAt: z.iso.datetime().nullable().describe('수정일시'),
        channel: z
          .object({
            id: z.uuid().describe('채널 ID'),
            type: z.string().describe('채널 타입'),
            name: z.string().describe('채널명'),
            isActive: z.boolean().nullable().describe('활성 여부'),
            apiConfig: z.any().describe('API 설정'),
            supportedFeatures: z.any().describe('지원 기능'),
            createdAt: z.iso.datetime().nullable().describe('생성일시'),
            updatedAt: z.iso.datetime().nullable().describe('수정일시'),
          })
          .describe('채널 정보'),
      }),
    )
    .describe('채널별 제품들'),
});

export const PricePreviewSchema = z.object({
  masterId: z.uuid().describe('제품 마스터 ID'),
  variants: z
    .array(
      z.object({
        variantId: z.string().describe('변형 ID'),
        optionCombination: z.string().describe('옵션 조합'),
        price: z.number().describe('계산된 가격'),
      }),
    )
    .describe('변형별 가격 목록'),
});

// 상품 목록용 간단한 스키마 (목록 조회용)
export const MasterListItemSchema = z.object({
  id: z.string().describe('제품 마스터 ID'),
  name: z.string().describe('제품 마스터 이름'),
  thumbnail: z.string().nullable().describe('썸네일 이미지 URL'),
  basePrice: z.number().nullable().describe('기본 가격'),
  membershipPrice: z.number().nullable().describe('멤버십 전용 가격'),
  isMembershipOnly: z.boolean().nullable().describe('멤버십회원 전용 여부'),
  status: z.string().nullable().describe('제품 상태'),
  createdAt: z.iso.datetime().nullable().describe('생성일시'),
});

export const MasterListResponseSchema = z.object({
  data: z.array(MasterListItemSchema).describe('제품 마스터 목록'),
  page: z.number().int().min(1).describe('현재 페이지 번호'),
  limit: z.number().int().min(1).describe('페이지당 아이템 수'),
  total: z.number().int().min(0).describe('전체 아이템 수'),
});

export const MasterUpdateResponseSchema = z.object({
  success: z.boolean().describe('수정 성공 여부'),
  data: ProductMasterSchema.describe('수정된 제품 마스터 정보'),
});

// DTO 클래스들
export class CreateMasterDto extends createZodDto(CreateMasterSchema) {}
export class UpdateProductMasterDto extends createZodDto(
  UpdateProductMasterSchema,
) {}
export class ChangePricingStrategyDto extends createZodDto(
  ChangePricingStrategySchema,
) {}
export class ProductMasterDto extends createZodDto(ProductMasterSchema) {}
export class MasterDetailDto extends createZodDto(MasterDetailSchema) {}
export class PricePreviewDto extends createZodDto(PricePreviewSchema) {}
export class MasterListItemDto extends createZodDto(MasterListItemSchema) {}
export class MasterListResponseDto extends createZodDto(
  MasterListResponseSchema,
) {}
export class MasterUpdateResponseDto extends createZodDto(
  MasterUpdateResponseSchema,
) {}
