import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InboundPipelineItemDto {
  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: '발주 잔량 (비판매 창고 입고 예정)' })
  onOrderQty: number;

  @ApiPropertyOptional({ description: '발주 도착 예정일', nullable: true, type: Date })
  onOrderEta: Date | null;

  @ApiProperty({ description: '이동 대기 (출발 창고 보유, 미선적)' })
  awaitingTransferQty: number;

  @ApiProperty({ description: '이동 중 (미도착 잔량)' })
  inTransitQty: number;

  @ApiPropertyOptional({ description: '이동 도착 예정일', nullable: true, type: Date })
  inTransitEta: Date | null;
}

export class InboundPipelineResponseDto {
  @ApiProperty({ type: [InboundPipelineItemDto] })
  items: InboundPipelineItemDto[];
}
