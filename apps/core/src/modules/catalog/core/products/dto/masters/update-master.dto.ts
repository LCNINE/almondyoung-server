import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsUUID,
  IsNumber,
  IsUrl,
  IsArray,
  IsEnum,
  IsBoolean,
  IsPositive,
  MinLength,
  ValidateNested,
  ArrayUnique,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OptionDiffDto } from './option-diff.dto';

export class UpdateProductMasterDto {
  @ApiProperty({
    description: '제품 마스터 이름',
    minLength: 1,
    required: false,
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
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  categoryIds?: string[];

  @ApiProperty({
    description: '주 카테고리 ID',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  primaryCategoryId?: string;

  @ApiProperty({ description: '브랜드명', required: false })
  @IsOptional()
  @IsString()
  brand?: string;

  // basePrice removed - 가격은 pricing rules API로 설정

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
    required: false,
  })
  @IsOptional()
  @IsEnum(['active', 'inactive', 'draft'])
  status?: 'active' | 'inactive' | 'draft';

  @ApiProperty({
    description: '배송 유형 (physical: 배송비 부과 / digital: 배송 불필요·배송비 면제)',
    enum: ['physical', 'digital'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['physical', 'digital'])
  fulfillmentKind?: 'physical' | 'digital';

  // ========== 이미지 관련 필드 ==========

  @ApiProperty({ description: '썸네일 파일 ID (file-service)', required: false })
  @IsOptional()
  @IsUUID()
  thumbnailFileId?: string;

  @ApiProperty({ description: '부가 이미지 파일 ID 배열 (최대 5개, file-service)', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  additionalImageFileIds?: string[];

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

  @ApiProperty({
    description: '멤버십가 비공개 여부 (비회원에게 멤버십가 숨김 — 상품 노출·구매 제한 아님)',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  hideMembershipPriceForNonMembers?: boolean;

  @ApiProperty({ description: '멤버십 회원 전용 노출 여부 (비회원 목록·검색·상세에서 숨김)', required: false })
  @IsOptional()
  @IsBoolean()
  isVisibleToMembersOnly?: boolean;

  @ApiProperty({
    description: 'Deprecated. hideMembershipPriceForNonMembers를 사용하세요.',
    required: false,
    deprecated: true,
  })
  @IsOptional()
  @IsBoolean()
  isMembershipOnly?: boolean;

  @ApiProperty({
    description: '옵션 변경사항',
    type: OptionDiffDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => OptionDiffDto)
  optionDiff?: OptionDiffDto;

  @ApiProperty({
    description: '태그 값 ID 배열 (기존 태그를 모두 대체)',
    type: [String],
    required: false,
    example: ['550e8400-e29b-41d4-a716-446655440000'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'Tag value IDs must be unique' })
  @IsUUID(undefined, { each: true })
  tagValueIds?: string[];
}
