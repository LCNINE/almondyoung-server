import { ApiProperty } from '@nestjs/swagger';
import { ProductSellableQuantityReason } from '../services/product-sellable-quantity.calculator';

export class ProductSellableQuantityComponentDto {
  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: '판매상품 variant 1개에 필요한 SKU 구성 수량' })
  requiredQuantity: number;

  @ApiProperty({ description: '전체 창고 기준 SKU available quantity 합계' })
  availableQuantity: number;

  @ApiProperty({ description: '이 SKU 컴포넌트만 놓고 만들 수 있는 판매상품 수량' })
  componentSellableQuantity: number;
}

export class ProductSellableQuantityDto {
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

  @ApiProperty({
    description: '판매가능수량 결정 사유',
    enum: [
      'SELLABLE',
      'PRE_STOCK_SELLABLE',
      'ALWAYS_SELLABLE_ZERO_STOCK',
      'MANUAL_OUT_OF_STOCK',
      'NOT_ACTIVE_VERSION',
      'VARIANT_INACTIVE',
      'SALES_NOT_STARTED',
      'SALES_ENDED',
      'MATCHING_MISSING',
      'MATCHING_PENDING',
      'MATCHING_IGNORED',
      'MATCHING_STRATEGY_UNSUPPORTED',
      'MATCHING_LINK_MISSING',
      'INSUFFICIENT_COMPONENT_STOCK',
    ],
  })
  reason: ProductSellableQuantityReason;

  @ApiProperty({ description: '입고 전 판매 허용 정책' })
  preStockSellable: boolean;

  @ApiProperty({ description: '재고 0이어도 항상 판매 가능 정책' })
  alwaysSellableZeroStock: boolean;

  @ApiProperty({ description: '수동 판매 가능 상태 override', enum: ['manual_out_of_stock'], nullable: true })
  availabilityOverride: 'manual_out_of_stock' | null;

  @ApiProperty({ type: [ProductSellableQuantityComponentDto] })
  components: ProductSellableQuantityComponentDto[];

  @ApiProperty({ description: '계산 시각' })
  calculatedAt: Date;
}
