import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsNumber, IsUrl, IsArray, IsEnum, IsBoolean, IsPositive, MinLength } from 'class-validator';

export class UpdateProductMasterDto {
  @ApiProperty({ 
    description: '제품 마스터 이름',
    minLength: 1,
    required: false
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiProperty({ description: '제품 설명', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ 
    description: '카테고리 ID 배열 (기존 카테고리를 모두 대체)',
    type: [String],
    required: false 
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @ApiProperty({ 
    description: '주 카테고리 ID',
    required: false 
  })
  @IsOptional()
  @IsUUID()
  primaryCategoryId?: string;

  @ApiProperty({ description: '브랜드명', required: false })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiProperty({ description: '기본 가격', minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  basePrice?: number;

  @ApiProperty({ description: '제품 이미지 URL 배열', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  images?: string[];

  @ApiProperty({ description: '제품 속성 (키-값 쌍)', required: false })
  @IsOptional()
  attributes?: Record<string, any>;

  @ApiProperty({ 
    description: '제품 상태',
    enum: ['active', 'inactive', 'draft'],
    required: false
  })
  @IsOptional()
  @IsEnum(['active', 'inactive', 'draft'])
  status?: 'active' | 'inactive' | 'draft';

  // ========== 이미지 관련 필드 ==========

  @ApiProperty({ description: '썸네일 URL', required: false })
  @IsOptional()
  @IsString()
  thumbnail?: string;

  @ApiProperty({ description: '썸네일 업로드 ID', required: false })
  @IsOptional()
  @IsUUID()
  thumbnailUploadId?: string;

  @ApiProperty({ description: '썸네일 외부 URL', required: false })
  @IsOptional()
  @IsUrl()
  thumbnailUrl?: string;

  @ApiProperty({ description: '부가 이미지 업로드 ID 배열 (최대 5개)', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  additionalImageUploadIds?: string[];

  // ========== 마케팅/SEO 필드 ==========

  @ApiProperty({ description: '마케팅 태그', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ description: 'SEO 제목', required: false })
  @IsOptional()
  @IsString()
  seoTitle?: string;

  @ApiProperty({ description: 'SEO 설명', required: false })
  @IsOptional()
  @IsString()
  seoDescription?: string;

  @ApiProperty({ description: 'SEO 키워드', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  seoKeywords?: string[];

  @ApiProperty({ description: '상품 상세설명 HTML', required: false })
  @IsOptional()
  @IsString()
  descriptionHtml?: string;

  // ========== 구매 제한 및 특별 가격 필드 ==========

  @ApiProperty({ description: '도매회원 전용 여부', required: false })
  @IsOptional()
  @IsBoolean()
  isWholesaleOnly?: boolean;

  @ApiProperty({ description: '멤버십회원 전용 여부', required: false })
  @IsOptional()
  @IsBoolean()
  isMembershipOnly?: boolean;
}

