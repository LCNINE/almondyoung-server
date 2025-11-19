import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

// Zod schema for simplified creation - all fields optional
// Product is created as empty draft, then filled via update API
export const CreateMasterSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  brand: z.string().optional(),
  thumbnail: z.string().optional(),
  thumbnailUploadId: z.string().uuid().optional(),
  additionalImageUploadIds: z.array(z.string().uuid()).max(5, '부가 이미지는 최대 5개까지 가능합니다').optional(),
  // basePrice removed - 가격은 전적으로 pricing rules로 결정
  tags: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  seoKeywords: z.array(z.string()).optional(),
  descriptionHtml: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
  isWholesaleOnly: z.boolean().optional(),
  isMembershipOnly: z.boolean().optional(),
  // optionGroups removed - use update API with optionDiff instead
  categoryIds: z.array(z.uuid()).optional(),
  primaryCategoryId: z.uuid().optional(),
});

export type CreateMasterDto = z.infer<typeof CreateMasterSchema>;

// Swagger documentation class - all fields optional for simplified creation
export class CreateMasterDtoSwagger {
  @ApiProperty({ 
    description: '제품명 (미입력 시 "새 상품")', 
    required: false,
    example: '무선 이어폰'
  })
  name?: string;

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

  // basePrice removed - 가격은 pricing rules API로 설정

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

  @ApiProperty({ description: '도매회원 전용 여부', required: false })
  isWholesaleOnly?: boolean;

  @ApiProperty({ description: '멤버십회원 전용 여부', required: false })
  isMembershipOnly?: boolean;

  // optionGroups removed - use PUT /masters/:id with optionDiff instead

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

