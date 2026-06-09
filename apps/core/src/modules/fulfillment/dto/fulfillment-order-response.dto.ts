import { ApiProperty } from '@nestjs/swagger';

export class InvoiceSummaryDto {
  @ApiProperty({ description: 'Invoice ID' })
  id: string;

  @ApiProperty({ description: '송장번호' })
  invoiceNumber: string;

  @ApiProperty({ description: 'Invoice 상태', enum: ['issued', 'printed', 'shipped', 'canceled'] })
  status: string;

  @ApiProperty({ description: '택배사 코드', nullable: true })
  carrierCode: string | null;

  @ApiProperty({ description: '송장 발급 방식', enum: ['goodsflow', 'direct', 'self'] })
  issueMethod: string;
}

export class FulfillmentOrderItemDto {
  @ApiProperty({ description: 'Fulfillment Order Item ID' })
  id: string;

  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: 'SKU 코드' })
  skuCode: string;

  @ApiProperty({ description: 'SKU 명' })
  skuName: string;

  @ApiProperty({ description: '요청 수량' })
  qty: number;

  @ApiProperty({ description: '예약 수량' })
  reservedQty: number;

  @ApiProperty({ description: '피킹 수량' })
  pickedQty: number;

  @ApiProperty({ description: '출고 수량' })
  shippedQty: number;

  @ApiProperty({ description: 'FOI 상태 (pending/shipped/approved/rejected/partial 등)' })
  status: string;

  @ApiProperty({ description: '원본 Sales Order ID', nullable: true })
  salesOrderId: string | null;

  @ApiProperty({ description: '원본 Sales Order Line ID', nullable: true })
  salesOrderLineId: string | null;
}

export class FulfillmentOrderResponseDto {
  @ApiProperty({ description: 'Fulfillment Order ID' })
  id: string;

  @ApiProperty({ description: 'Sales Order ID', nullable: true })
  salesOrderId: string | null;

  @ApiProperty({ description: 'Warehouse ID', nullable: true })
  warehouseId: string | null;

  @ApiProperty({ description: 'Owner ID (for 3PL)', nullable: true })
  ownerId: string | null;

  @ApiProperty({
    description: 'Fulfillment Order 상태',
    enum: [
      'created',
      'reserving',
      'ready',
      'unfulfillable',
      'labeled',
      'shipped',
      'canceled',
      'pending',
      'allocated',
      'picking',
      'picked',
      'inspecting',
      'invoiced',
      'completed',
      'forwarded',
    ],
  })
  status: string;

  @ApiProperty({ description: 'Batch ID', nullable: true })
  batchId: string | null;

  @ApiProperty({ description: 'Fulfillment Mode', enum: ['in_house', '3pl', 'drop_ship'], nullable: true })
  fulfillmentMode: string | null;

  @ApiProperty({ description: '우선순위', enum: ['normal', 'high', 'urgent'] })
  priority: string;

  @ApiProperty({ description: '총 아이템 수' })
  totalItems: number;

  @ApiProperty({ description: '총 수량' })
  totalQty: number;

  @ApiProperty({ description: '총 예약 수량' })
  totalReservedQty: number;

  @ApiProperty({ description: '예약 실패 사유', nullable: true })
  reservationFailureReason: string | null;

  @ApiProperty({ description: '예약 실패 상세', nullable: true })
  reservationFailureDetails: unknown | null;

  @ApiProperty({ description: '할당 일시', nullable: true })
  allocatedAt: Date | null;

  @ApiProperty({ description: '출고 일시', nullable: true })
  shippedAt: Date | null;

  @ApiProperty({ description: '취소 일시', nullable: true })
  canceledAt: Date | null;

  @ApiProperty({ description: '배송지 정보', nullable: true })
  shippingAddress: unknown | null;

  @ApiProperty({ description: '라벨 번호', nullable: true })
  labelNo: string | null;

  @ApiProperty({ description: '생성 일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정 일시' })
  updatedAt: Date;

  @ApiProperty({ description: 'Invoice 정보', type: InvoiceSummaryDto, nullable: true })
  invoice: InvoiceSummaryDto | null;

  @ApiProperty({
    description: 'FOI 라인 (상세 조회 시에만 포함)',
    type: [FulfillmentOrderItemDto],
    nullable: true,
  })
  items?: FulfillmentOrderItemDto[];
}

export class FulfillmentOrderListResponseDto {
  @ApiProperty({ description: '출고주문 목록', type: [FulfillmentOrderResponseDto] })
  data: FulfillmentOrderResponseDto[];

  @ApiProperty({ description: '전체 개수 (필터 적용 후)' })
  total: number;
}
