import { ApiProperty } from '@nestjs/swagger';
import { ProductTagDto } from './product-tag.dto';
import { ProductImageDto } from '../products/product-image.dto';

export class ProductMasterDto {
  @ApiProperty({ description: '제품 마스터 ID (UUID 형식)' })
  id: string;

  @ApiProperty({ description: '제품 마스터 이름' })
  name: string;

  @ApiProperty({ description: '제품 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '브랜드명', nullable: true })
  brand: string | null;

  // basePrice removed - 가격은 pricing rules로 조회
  // tags removed - 별도 태그 테이블로 정규화됨
  // attributes removed - 삭제됨

  @ApiProperty({
    description: '제품 이미지 목록',
    type: [ProductImageDto],
    required: false,
    nullable: true,
  })
  images: ProductImageDto[] | null;

  @ApiProperty({ description: 'SEO 제목', nullable: true })
  seoTitle: string | null;

  @ApiProperty({ description: 'SEO 설명', nullable: true })
  seoDescription: string | null;

  @ApiProperty({ description: 'SEO 키워드', type: [String], nullable: true })
  seoKeywords: string[] | null;

  @ApiProperty({ description: '제품 상태', nullable: true })
  status: string | null;

  @ApiProperty({ description: '도매회원 전용 여부', nullable: true })
  isWholesaleOnly: boolean | null;

  @ApiProperty({ description: '멤버십가 비공개 여부 (비회원에게 멤버십가 숨김 — 상품 노출·구매 제한 아님)', nullable: true })
  isMembershipOnly: boolean | null;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;

  @ApiProperty({ description: '생성자', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: '수정자', nullable: true })
  updatedBy: string | null;
}

export class OptionValueDto {
  @ApiProperty({ description: '옵션 값 ID' })
  id: string;

  @ApiProperty({ description: '옵션 값' })
  value: string;

  @ApiProperty({ description: '옵션 값 표시명' })
  displayName: string;

  @ApiProperty({ description: '정렬 순서' })
  sortOrder: number;

  @ApiProperty({ description: '활성 여부' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;
}

export class OptionGroupDto {
  @ApiProperty({ description: '옵션 그룹 ID' })
  id: string;

  @ApiProperty({ description: '옵션 그룹 표시명' })
  displayName: string;

  @ApiProperty({ description: '정렬 순서' })
  sortOrder: number;

  @ApiProperty({ description: '필수 여부' })
  isRequired: boolean;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '옵션 값들', type: [OptionValueDto] })
  values: OptionValueDto[];
}

export class VariantDto {
  @ApiProperty({ description: '변형 ID' })
  id: string;

  @ApiProperty({ description: '마스터 ID' })
  masterId: string;

  @ApiProperty({ description: '변형명', nullable: true })
  variantName: string | null;

  @ApiProperty({ description: '품목 이미지 ID', nullable: true })
  imageId: string | null;

  @ApiProperty({ description: '표시 순서', nullable: true })
  displayOrder: number | null;

  @ApiProperty({ description: '변형 상태', nullable: true })
  status: string | null;

  @ApiProperty({ description: '기본 변형 여부', nullable: true })
  isDefault: boolean | null;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;

  @ApiProperty({ description: '옵션 값들' })
  optionValues: any[];

  @ApiProperty({ description: '계산된 가격', required: false })
  price?: number;
}
