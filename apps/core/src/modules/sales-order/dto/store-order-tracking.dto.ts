import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StoreTrackingEventDto {
  @ApiProperty({ description: '배송 이벤트 상태', example: 'in_transit' })
  status: string;

  @ApiPropertyOptional({ description: '현재 위치', example: '서울 허브터미널' })
  location: string | null;

  @ApiProperty({ description: '이벤트 발생 시각' })
  timestamp: Date;
}

export class StoreShipmentDto {
  @ApiProperty({ description: '출고주문 ID' })
  fulfillmentOrderId: string;

  @ApiProperty({ description: '택배사 코드', example: 'CJ' })
  carrier: string;

  @ApiProperty({ description: '택배사 이름', example: 'CJ대한통운' })
  carrierName: string;

  @ApiProperty({ description: '송장번호', example: '1234567890' })
  trackingNumber: string;

  @ApiPropertyOptional({ description: '택배사 배송조회 URL' })
  trackingUrl: string | null;

  @ApiProperty({ description: '출고 상태', example: 'in_transit' })
  status: string;

  @ApiPropertyOptional({ description: '출고일시' })
  shippedAt: Date | null;

  @ApiPropertyOptional({ description: '배송완료일시' })
  deliveredAt: Date | null;

  @ApiPropertyOptional({ description: '예상 도착일' })
  eta: Date | null;

  @ApiProperty({ description: '배송 이벤트 목록', type: [StoreTrackingEventDto] })
  trackingEvents: StoreTrackingEventDto[];
}

export class StoreOrderTrackingResponseDto {
  @ApiProperty({ description: 'Core 판매주문 ID' })
  orderId: string;

  @ApiProperty({ description: '채널 주문 ID (Medusa order ID)' })
  channelOrderId: string;

  @ApiProperty({
    description: '전체 배송 상태',
    enum: ['not_shipped', 'preparing', 'shipping', 'delivered'],
    example: 'shipping',
  })
  status: 'not_shipped' | 'preparing' | 'shipping' | 'delivered';

  @ApiProperty({ description: '출고 정보 목록', type: [StoreShipmentDto] })
  shipments: StoreShipmentDto[];
}
