import { ApiProperty } from '@nestjs/swagger';

export class CurrentStockDto {
  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: 'SKU 이름' })
  skuName: string;

  @ApiProperty({ description: '창고 ID' })
  warehouseId: string;

  @ApiProperty({ description: '창고 이름' })
  warehouseName: string;

  @ApiProperty({ description: '가용재고 (ON_HAND)' })
  onHandQty: number;

  @ApiProperty({ description: '불량재고 (DEFECTIVE)' })
  defectiveQty: number;

  @ApiProperty({ description: '이동중재고 (IN_TRANSFER)' })
  inTransferQty: number;

  @ApiProperty({ description: '예약된 수량' })
  reservedQty: number;

  @ApiProperty({ description: '실제 사용가능 수량 (onHand - reserved)' })
  availableQty: number;

  @ApiProperty({ description: '입고 예정 수량' })
  inboundPendingQty: number;

  @ApiProperty({ description: '예상 가용 수량 (available + inboundPending)' })
  projectedAvailableQty: number;

  @ApiProperty({ description: '마지막 계산 시간' })
  lastCalculatedAt: Date;
}
