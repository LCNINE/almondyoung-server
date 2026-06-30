import { ApiProperty } from '@nestjs/swagger';

export class InvoiceSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  invoiceNumber: string;

  @ApiProperty({ enum: ['issued', 'used', 'voided'] })
  status: string;

  @ApiProperty({ nullable: true })
  carrierCode: string | null;

  @ApiProperty({ enum: ['goodsflow', 'hanjin', 'direct', 'self'] })
  issueMethod: string;
}

export class FulfillmentOrderItemDto {
  @ApiProperty({ description: 'Fulfillment Order Item ID' })
  id: string;

  @ApiProperty({ description: 'Fulfillment Order ID', required: false })
  fulfillmentOrderId?: string;

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

  @ApiProperty({ description: '원본 variant ID', nullable: true })
  variantId: string | null;
}

export class ReservationSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  fulfillmentOrderItemId: string | null;

  @ApiProperty()
  skuId: string;

  @ApiProperty()
  warehouseId: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  status: string;
}

export class ShipmentSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  trackingNo: string;

  @ApiProperty()
  carrier: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ nullable: true })
  eta: Date | null;

  @ApiProperty({ nullable: true })
  invoiceUrl: string | null;
}

export class BatchSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  batchNumber: string;
}

export class FulfillmentOrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  salesOrderId: string | null;

  @ApiProperty({ nullable: true })
  warehouseId: string | null;

  @ApiProperty({ nullable: true })
  ownerId: string | null;

  @ApiProperty({
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
      'inspected',
      'invoiced',
      'completed',
      'forwarded',
    ],
  })
  status: string;

  @ApiProperty({ nullable: true })
  batchId: string | null;

  @ApiProperty({ enum: ['in_house', '3pl', 'drop_ship'], nullable: true })
  fulfillmentMode: string | null;

  @ApiProperty({ enum: ['pending', 'forwarded', 'completed', 'canceled'], nullable: true })
  directShipStatus: string | null;

  @ApiProperty({ enum: ['normal', 'high', 'urgent'] })
  priority: string;

  @ApiProperty()
  totalItems: number;

  @ApiProperty()
  totalQty: number;

  @ApiProperty()
  totalReservedQty: number;

  @ApiProperty({ nullable: true })
  reservationFailureReason: string | null;

  @ApiProperty({ nullable: true })
  reservationFailureDetails: unknown | null;

  @ApiProperty({ nullable: true })
  allocatedAt: Date | null;

  @ApiProperty({ nullable: true })
  shippedAt: Date | null;

  @ApiProperty({ nullable: true })
  canceledAt: Date | null;

  @ApiProperty({ nullable: true })
  shippingAddress: unknown | null;

  @ApiProperty({ nullable: true })
  labelNo: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: InvoiceSummaryDto, nullable: true })
  invoice: InvoiceSummaryDto | null;

  @ApiProperty({ type: ShipmentSummaryDto, nullable: true, required: false })
  shipment?: ShipmentSummaryDto | null;

  @ApiProperty({ type: BatchSummaryDto, nullable: true, required: false })
  batch?: BatchSummaryDto | null;

  @ApiProperty({
    description: 'FOI 라인 (상세 조회 시에만 포함)',
    type: [FulfillmentOrderItemDto],
    nullable: true,
  })
  items?: FulfillmentOrderItemDto[];

  @ApiProperty({
    description: '재고 예약 레코드 (상세 조회 시에만 포함)',
    type: [ReservationSummaryDto],
    required: false,
  })
  reservations?: ReservationSummaryDto[];

  @ApiProperty({ description: '관리자 UI에서 현재 실행 가능한 액션', type: [String], required: false })
  adminAvailableActions?: string[];

  @ApiProperty({ description: '관리자 액션 차단 사유', type: [String], required: false })
  blockedReasons?: string[];
}

export class FulfillmentOrderListResponseDto {
  @ApiProperty({ description: '출고주문 목록', type: [FulfillmentOrderResponseDto] })
  data: FulfillmentOrderResponseDto[];

  @ApiProperty({ description: '전체 개수 (필터 적용 후)' })
  total: number;
}
