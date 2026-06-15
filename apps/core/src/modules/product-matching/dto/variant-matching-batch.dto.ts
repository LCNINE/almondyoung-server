import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ProductSellableQuantityReason } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.calculator';

export class BatchVariantMatchingsRequestDto {
  @ApiProperty({
    description: '조회할 variant ID 목록. 응답은 입력 순서와 중복을 보존합니다.',
    type: [String],
    maxItems: 500,
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  variantIds: string[];
}

export class UpdateVariantStockPolicyDto {
  @ApiProperty({ description: '입고 전 판매 허용 정책', required: false })
  @IsOptional()
  @IsBoolean()
  preStockSellable?: boolean;

  @ApiProperty({ description: '재고 0이어도 항상 판매 가능 정책', required: false })
  @IsOptional()
  @IsBoolean()
  alwaysSellableZeroStock?: boolean;

  @ApiProperty({
    description: '수동 판매 가능 상태 override',
    required: false,
    nullable: true,
    enum: ['manual_out_of_stock'],
  })
  @IsOptional()
  @IsEnum(['manual_out_of_stock'])
  availabilityOverride?: 'manual_out_of_stock' | null;
}

export class VariantStockPolicyDto {
  @ApiProperty({ description: '입고 전 판매 허용 정책' })
  preStockSellable: boolean;

  @ApiProperty({ description: '재고 0이어도 항상 판매 가능 정책' })
  alwaysSellableZeroStock: boolean;

  @ApiProperty({ description: '수동 판매 가능 상태 override', nullable: true, enum: ['manual_out_of_stock'] })
  availabilityOverride: 'manual_out_of_stock' | null;
}

export class ProductSellableQuantityProjectionComponentDto {
  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: '판매상품 variant 1개에 필요한 SKU 구성 수량' })
  requiredQuantity: number;

  @ApiProperty({ description: '전체 창고 기준 SKU available quantity 합계' })
  availableQuantity: number;

  @ApiProperty({ description: '이 SKU 컴포넌트만 놓고 만들 수 있는 판매상품 수량' })
  componentSellableQuantity: number;
}

export class ProductSellableQuantityProjectionViewDto {
  @ApiProperty({ description: 'Core catalog variant ID' })
  variantId: string;

  @ApiProperty({ description: 'Active product master ID', nullable: true })
  masterId: string | null;

  @ApiProperty({ description: 'Active product master version ID', nullable: true })
  versionId: string | null;

  @ApiProperty({ description: 'Product matching ID', nullable: true })
  matchingId: string | null;

  @ApiProperty({ description: '정책 반영 후 판매채널에 공유할 판매가능수량' })
  sellableQuantity: number;

  @ApiProperty({ description: 'SKU available quantity와 구성 수량만으로 계산한 재고 제한 수량' })
  stockBoundQuantity: number;

  @ApiProperty({ description: '현재 판매 가능한지 여부' })
  isSellable: boolean;

  @ApiProperty({ description: '판매가능수량 결정 사유' })
  reason: ProductSellableQuantityReason;

  @ApiProperty({ description: '입고 전 판매 허용 정책' })
  preStockSellable: boolean;

  @ApiProperty({ description: '재고 0이어도 항상 판매 가능 정책' })
  alwaysSellableZeroStock: boolean;

  @ApiProperty({ description: '수동 판매 가능 상태 override', nullable: true, enum: ['manual_out_of_stock'] })
  availabilityOverride: 'manual_out_of_stock' | null;

  @ApiProperty({ description: '계산 시각' })
  calculatedAt: string;

  @ApiProperty({ type: [ProductSellableQuantityProjectionComponentDto] })
  components: ProductSellableQuantityProjectionComponentDto[];
}

export class VariantMatchingBatchItemDto {
  @ApiProperty({ description: '요청한 variant ID' })
  variantId: string;

  @ApiProperty({ description: 'variant 존재 여부' })
  exists: boolean;

  @ApiProperty({ description: '운영 매칭 정보', nullable: true })
  matching: Record<string, unknown> | null;

  @ApiProperty({ type: VariantStockPolicyDto })
  stockPolicy: VariantStockPolicyDto;

  @ApiProperty({ type: ProductSellableQuantityProjectionViewDto, nullable: true })
  projection: ProductSellableQuantityProjectionViewDto | null;
}

export class VariantMatchingBatchResponseDto {
  @ApiProperty({ type: [VariantMatchingBatchItemDto] })
  data: VariantMatchingBatchItemDto[];
}
