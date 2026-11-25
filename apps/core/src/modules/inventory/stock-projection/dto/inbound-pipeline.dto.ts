import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InboundPipelineItemDto {
  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: '발주 잔량 (비판매 창고 입고 예정)' })
  onOrderQty: number;

  @ApiPropertyOptional({ description: '발주 도착 예정일', nullable: true, type: Date })
  onOrderEta: Date | null;

  @ApiProperty({ description: '발주 잔량 (창고 불문, 전사 축용)' })
  onOrderTotalQty: number;

  @ApiPropertyOptional({
    description: '판매 창고행 발주의 가장 이른 입고 예정일 (YYYY-MM-DD)',
    nullable: true,
    type: String,
  })
  onOrderToSellableEta: string | null;

  @ApiProperty({ description: '이동 대기 (출발 창고 보유, 미선적)' })
  awaitingTransferQty: number;

  @ApiProperty({ description: '이동 중 (미도착 잔량)' })
  inTransitQty: number;

  @ApiPropertyOptional({ description: '이동 도착 예정일', nullable: true, type: Date })
  inTransitEta: Date | null;

  @ApiProperty({ description: '선적 오는 중 (외부 선적 잔량, 창고 불문)' })
  inboundShipmentQty: number;

  @ApiProperty({ description: '선적 오는 중 중 판매 창고행' })
  inboundShipmentToSellableQty: number;

  @ApiPropertyOptional({
    description: '판매 창고행 선적의 가장 이른 도착 예정일 (YYYY-MM-DD)',
    nullable: true,
    type: String,
  })
  inboundShipmentEta: string | null;
}

export class InboundPipelineResponseDto {
  @ApiProperty({ type: [InboundPipelineItemDto] })
  items: InboundPipelineItemDto[];
}
