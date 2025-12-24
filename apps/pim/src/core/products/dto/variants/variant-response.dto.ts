import { ApiProperty } from '@nestjs/swagger';

export class ProductVariantDto {
  @ApiProperty({ description: '제품 변형 ID (UUID 형식)' })
  id: string;

  @ApiProperty({ description: '제품 마스터 ID (UUID 형식)' })
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
}

export class VariantWithPriceDto extends ProductVariantDto {
  @ApiProperty({ description: '계산된 가격' })
  price: number;

  @ApiProperty({ description: '옵션 값들' })
  optionValues: any[];
}

export class VariantListResponseDto {
  @ApiProperty({ description: '제품 변형 목록', type: [VariantWithPriceDto] })
  data: VariantWithPriceDto[];

  @ApiProperty({ description: '전체 아이템 수', minimum: 0 })
  total: number;

  @ApiProperty({ description: '현재 페이지 번호', minimum: 1 })
  page: number;

  @ApiProperty({ description: '페이지당 아이템 수', minimum: 1 })
  limit: number;
}

export class VariantUpdateResponseDto {
  @ApiProperty({ description: '수정 성공 여부' })
  success: boolean;

  @ApiProperty({ description: '수정된 제품 변형 정보', type: VariantWithPriceDto })
  data: VariantWithPriceDto;
}

export class VariantPriceResponseDto {
  @ApiProperty({ description: '제품 변형 ID' })
  variantId: string;

  @ApiProperty({ description: '계산된 가격' })
  price: number;
}

