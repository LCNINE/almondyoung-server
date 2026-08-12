import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTransferOrderResponseDto {
  @ApiProperty({ description: '생성된 이동 지시서 ID' })
  transferOrderId: string;
}

export class ShipTransferOrderResponseDto {
  @ApiProperty({ description: '선적된 라인 수' })
  shippedLines: number;
}

export class ReceiveTransferResponseDto {
  @ApiProperty({ description: '생성된 도착 회차 ID' })
  receiptId: string;
}

export class OutstandingTransferDto {
  @ApiProperty() transferOrderId: string;
  @ApiProperty() transferOrderLineId: string;
  @ApiProperty() skuId: string;
  @ApiProperty() toWarehouseId: string;
  @ApiProperty({ description: '미도착 잔량' }) outstandingQty: number;
  @ApiPropertyOptional({ description: '도착 예정일', nullable: true }) eta: Date | null;
  @ApiPropertyOptional({ description: '선적 시각', nullable: true }) shippedAt: Date | null;
}

export class OutstandingTransferListDto {
  @ApiProperty({ type: [OutstandingTransferDto] })
  items: OutstandingTransferDto[];
}
