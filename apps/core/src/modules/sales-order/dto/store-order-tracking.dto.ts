import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StoreTrackingEventDto {
  @ApiProperty({ description: '배송 이벤트 상태', example: 'in_transit' })
  status: string;

  @ApiPropertyOptional({ description: '현재 위치', example: '서울 허브터미널' })
  location: string | null;

  @ApiProperty({ description: '이벤트 발생 시각' })
  timestamp: Date;
}

export class StoreShipmentLineDto {
  @ApiProperty({ description: '출고 라인 ID' })
  shipmentLineId: string;

  @ApiProperty({ description: '출고주문 아이템 ID' })
  fulfillmentOrderItemId: string;

  @ApiProperty({ description: 'Core 판매주문 라인 ID' })
  salesOrderLineId: string;

  @ApiPropertyOptional({ description: '채널 주문 상품 ID' })
  channelOrderItemId: string | null;

  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: '이 shipment에 포함된 수량', example: 1 })
  quantity: number;
}

export class StoreDispatchAttemptDto {
  @ApiProperty({ description: '출고 시도 ID' })
  dispatchAttemptId: string;

  @ApiProperty({ description: '출고 시도 순번', example: 1 })
  attemptNo: number;

  @ApiProperty({ description: '운송 증거로 계산한 시도 상태', example: 'in_transit' })
  status: string;

  @ApiProperty({ description: '회수된 출고 시도인지 여부' })
  recalled: boolean;

  @ApiPropertyOptional({ description: '송장 ID' })
  invoiceId: string | null;

  @ApiProperty({ description: '택배사 코드', example: 'CJ' })
  carrier: string;

  @ApiProperty({ description: '택배사 이름', example: 'CJ대한통운' })
  carrierName: string;

  @ApiProperty({ description: '송장번호', example: '1234567890' })
  trackingNumber: string;

  @ApiPropertyOptional({ description: '택배사 배송조회 URL' })
  trackingUrl: string | null;

  @ApiPropertyOptional({ description: '출고일시' })
  dispatchedAt: Date | null;

  @ApiPropertyOptional({ description: '택배사 인수 확인 시각' })
  carrierAcceptedAt: Date | null;

  @ApiPropertyOptional({ description: '출고 회수 시각' })
  recalledAt: Date | null;

  @ApiProperty({ description: '이 출고 시도에 속한 배송 이벤트 목록', type: [StoreTrackingEventDto] })
  trackingEvents: StoreTrackingEventDto[];
}

export class StoreShipmentDto {
  @ApiPropertyOptional({ description: 'Shipment ID (선발급 legacy 송장은 null)' })
  shipmentId: string | null;

  @ApiProperty({ description: '출고주문 ID' })
  fulfillmentOrderId: string;

  @ApiProperty({ description: '이 주문에서 shipment에 연결된 출고주문 ID 목록', type: [String] })
  fulfillmentOrderIds: string[];

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

  @ApiProperty({ description: '현재 주문에 속한 shipment line 목록', type: [StoreShipmentLineDto] })
  lines: StoreShipmentLineDto[];

  @ApiProperty({ description: '재출고와 회수를 포함한 출고 시도 이력', type: [StoreDispatchAttemptDto] })
  dispatchAttempts: StoreDispatchAttemptDto[];
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
