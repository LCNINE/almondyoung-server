import { IsUUID, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../shared/dto';

export class GetStockSummaryListQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: 'SKU ID 필터', required: false })
  @IsUUID()
  @IsOptional()
  skuId?: string;

  @ApiProperty({ description: '창고 ID 필터', required: false })
  @IsUUID()
  @IsOptional()
  warehouseId?: string;
}

export class StockSummaryListItemDto {
  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: 'SKU 이름' })
  skuName: string;

  @ApiProperty({ description: '창고 ID' })
  warehouseId: string;

  @ApiProperty({ description: '창고 이름' })
  warehouseName: string;

  @ApiProperty({ description: '현재 수량 (onHand + defective + inTransfer)' })
  currentQuantity: number;

  @ApiProperty({ description: '가용 수량' })
  availableQuantity: number;

  @ApiProperty({ description: '예약 수량' })
  reservedQuantity: number;

  @ApiProperty({ description: '입고 예정 수량' })
  inboundPendingQuantity: number;

  @ApiProperty({ description: '출고 예정 수량' })
  outboundPendingQuantity: number;

  @ApiProperty({ description: '마지막 계산 시간' })
  lastUpdated: Date;
}
