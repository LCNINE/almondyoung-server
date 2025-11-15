import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

// Zod schema for complex runtime validation
const PricingStrategySchema = z.enum(['option_based', 'variant_based'] as const);

export const CreateMasterSchema = z.object({
  name: z.string().min(1, '제품명은 필수입니다'),
  description: z.string().optional(),
  brand: z.string().optional(),
  thumbnail: z.string().optional(),
  thumbnailUploadId: z.string().uuid().optional(),
  additionalImageUploadIds: z.array(z.string().uuid()).max(5, '부가 이미지는 최대 5개까지 가능합니다').optional(),
  basePrice: z.number(),
  pricingStrategy: PricingStrategySchema,
  tags: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  seoKeywords: z.array(z.string()).optional(),
  descriptionHtml: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
  isWholesaleOnly: z.boolean().default(false),
  isMembershipOnly: z.boolean().default(false),
  membershipPrice: z.number().int().positive().optional(),
  wholesalePrice: z.number().int().positive().optional(),
  optionGroups: z.array(
    z.object({
      name: z.string(),
      displayName: z.string(),
      sortOrder: z.number().optional(),
      values: z.array(
        z.object({
          value: z.string(),
          displayName: z.string(),
          sortOrder: z.number().optional(),
        }),
      ),
    }),
  ).optional(),
  optionValuePrices: z.record(z.string(), z.number()).optional(),
  variantPrices: z.record(z.string(), z.number()).optional(),
  categoryIds: z.array(z.uuid()).optional(),
  primaryCategoryId: z.uuid().optional(),
});

export type CreateMasterDto = z.infer<typeof CreateMasterSchema>;

// Swagger documentation class
export class CreateMasterDtoSwagger {
  @ApiProperty({ description: '제품 마스터 이름', minLength: 1 })
  name: string;

  @ApiProperty({ description: '제품 설명', required: false })
  description?: string;

  @ApiProperty({ description: '브랜드명', required: false })
  brand?: string;

  @ApiProperty({ description: '썸네일 이미지 URL', required: false })
  thumbnail?: string;

  @ApiProperty({ description: '썸네일 이미지 업로드 ID', required: false })
  thumbnailUploadId?: string;

  @ApiProperty({ description: '부가 이미지 업로드 ID 배열 (최대 5개)', type: [String], required: false })
  additionalImageUploadIds?: string[];

  @ApiProperty({ description: '기본 가격' })
  basePrice: number;

  @ApiProperty({ description: '가격 전략', enum: ['option_based', 'variant_based'] })
  pricingStrategy: 'option_based' | 'variant_based';

  @ApiProperty({ description: '마케팅 태그', type: [String], required: false })
  tags?: string[];

  @ApiProperty({ description: '제품 이미지 URL 배열', type: [String], required: false })
  images?: string[];

  @ApiProperty({ description: '제품 속성 (키-값 쌍)', required: false })
  attributes?: Record<string, any>;

  @ApiProperty({ description: 'SEO 제목', required: false })
  seoTitle?: string;

  @ApiProperty({ description: 'SEO 설명', required: false })
  seoDescription?: string;

  @ApiProperty({ description: 'SEO 키워드', type: [String], required: false })
  seoKeywords?: string[];

  @ApiProperty({ description: '상품 상세설명 HTML', required: false })
  descriptionHtml?: string;

  @ApiProperty({ description: '썸네일 이미지 URL (외부 URL)', required: false })
  thumbnailUrl?: string;

  @ApiProperty({ description: '도매회원 전용 여부', default: false })
  isWholesaleOnly?: boolean;

  @ApiProperty({ description: '멤버십회원 전용 여부', default: false })
  isMembershipOnly?: boolean;

  @ApiProperty({ description: '멤버십 전용 가격 (원 단위)', required: false, minimum: 1 })
  membershipPrice?: number;

  @ApiProperty({ description: '도매 전용 가격 (원 단위)', required: false, minimum: 1 })
  wholesalePrice?: number;

  @ApiProperty({ 
    description: '옵션 그룹들 (구조 정의용, 가격 정보 제외)',
    required: false,
    example: [{
      name: 'color',
      displayName: '색상',
      sortOrder: 0,
      values: [
        { value: 'red', displayName: '빨강', sortOrder: 0 }
      ]
    }]
  })
  optionGroups?: Array<{
    name: string;
    displayName: string;
    sortOrder?: number;
    values: Array<{
      value: string;
      displayName: string;
      sortOrder?: number;
    }>;
  }>;

  @ApiProperty({ 
    description: '옵션값별 가격 (option_based 전략용)',
    example: { 'option-value-id-1': 5000, 'option-value-id-2': 3000 },
    required: false 
  })
  optionValuePrices?: Record<string, number>;

  @ApiProperty({ 
    description: 'Variant별 가격 (variant_based 전략용)',
    example: { 'variant-id-1': 15000, 'variant-id-2': 18000 },
    required: false 
  })
  variantPrices?: Record<string, number>;

  @ApiProperty({ 
    description: '카테고리 ID 배열 (UUID)',
    type: [String],
    required: false,
    example: ['550e8400-e29b-41d4-a716-446655440000']
  })
  categoryIds?: string[];

  @ApiProperty({ 
    description: '주 카테고리 ID (categoryIds 중 하나여야 함)',
    required: false 
  })
  primaryCategoryId?: string;
}

