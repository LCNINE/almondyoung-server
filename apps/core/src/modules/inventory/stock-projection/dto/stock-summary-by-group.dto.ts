import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../shared/dto';

// 기본 창고 UUID도 허용한다 — IsUUID는 version/variant 니블이 없는 기존 ID를 거부한다.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STOCK_QUEUES = ['unshipped', 'below_safety_stock', 'out_of_stock', 'inbound_pending'];

export class GetStockSummaryByGroupQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: '창고 ID', required: false })
  @IsOptional()
  @Matches(UUID_PATTERN)
  warehouseId?: string;

  @ApiProperty({ description: '공급사 ID (sku_suppliers)', required: false })
  @IsOptional()
  @Matches(UUID_PATTERN)
  supplierId?: string;

  @ApiProperty({ description: 'SKU 이름·코드·활성 상품명 부분 검색', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: '하나 이상의 SKU 행이 해당하는 상품 그룹', required: false, enum: STOCK_QUEUES })
  @IsOptional()
  @IsIn(STOCK_QUEUES)
  queue?: 'unshipped' | 'below_safety_stock' | 'out_of_stock' | 'inbound_pending';
}

export class StockSummaryGroupSkuDto {
  @ApiProperty()
  skuId: string;

  @ApiProperty()
  skuName: string;

  @ApiProperty()
  skuCode: string;

  @ApiProperty()
  warehouseId: string;

  @ApiProperty()
  warehouseName: string;

  @ApiProperty({ type: String, nullable: true })
  shelfPosition: string | null;

  @ApiProperty({ description: 'onHand + defective + inTransfer + returned' })
  currentQuantity: number;

  @ApiProperty()
  availableQuantity: number;

  @ApiProperty({ description: 'FOI 주문 수량 − 출고 수량 − 취소 수량의 양수 합계' })
  unshippedQuantity: number;

  @ApiProperty({ description: 'max(미출고 − 정상 재고(ON_HAND), 0)' })
  shortageQuantity: number;

  @ApiProperty({ type: Number, nullable: true, description: '보충 SKU override의 안전재고' })
  safetyStock: number | null;

  @ApiProperty()
  belowSafetyStock: boolean;
}

export class StockSummaryGroupDto {
  @ApiProperty({ type: String, nullable: true })
  groupId: string | null;

  @ApiProperty()
  groupName: string;

  @ApiProperty({ type: String, nullable: true })
  groupCode: string | null;

  @ApiProperty({ type: String, nullable: true })
  imageUrl: string | null;

  @ApiProperty({ type: [StockSummaryGroupSkuDto] })
  skus: StockSummaryGroupSkuDto[];
}
