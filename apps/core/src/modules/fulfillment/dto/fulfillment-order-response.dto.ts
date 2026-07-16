import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({ description: '취소 정산 수량' })
  canceledQty: number;

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

  @ApiProperty({ nullable: true, required: false })
  fulfillmentOrderItemId?: string | null;

  @ApiProperty({ nullable: true, required: false })
  shipmentLineId?: string | null;

  @ApiProperty()
  skuId: string;

  @ApiProperty()
  warehouseId: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  status: string;

  @ApiProperty({ nullable: true, required: false })
  requestedAt?: Date | null;
}

export class FulfillmentV2ProgressItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  qty: number;

  @ApiProperty()
  shippedQty: number;

  @ApiProperty()
  canceledQty: number;

  @ApiProperty()
  outstandingQty: number;

  @ApiProperty()
  confirmedReservedQty: number;

  @ApiProperty()
  activeLineQty: number;

  @ApiProperty()
  processing: boolean;

  @ApiProperty()
  recoveryRequired: boolean;

  @ApiProperty()
  status: string;
}

export class FulfillmentV2ProgressDto {
  @ApiProperty()
  status: string;

  @ApiProperty()
  totalQty: number;

  @ApiProperty()
  shippedQty: number;

  @ApiProperty()
  canceledQty: number;

  @ApiProperty()
  outstandingQty: number;

  @ApiProperty()
  confirmedReservedQty: number;

  @ApiProperty({ type: [FulfillmentV2ProgressItemDto] })
  items: FulfillmentV2ProgressItemDto[];
}

export class FulfillmentV2ShipmentSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  manifestVersion: number;

  @ApiProperty()
  reservationVersion: number;

  @ApiProperty({ nullable: true })
  shippingProfileId: string | null;

  @ApiProperty()
  qty: number;

  @ApiProperty()
  reservedQty: number;
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

  @ApiProperty({ description: 'V2 demand-settlement progress', type: FulfillmentV2ProgressDto, required: false })
  progress?: FulfillmentV2ProgressDto;

  @ApiProperty({
    description: 'V2 shipment 목록. 단일 current shipment를 가정하지 않는다.',
    type: [FulfillmentV2ShipmentSummaryDto],
    required: false,
  })
  shipments?: FulfillmentV2ShipmentSummaryDto[];
}

/** V2 read contract deliberately has no singular `shipment` or `invoice`. */
export class FulfillmentOrderV2ResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  salesOrderId: string | null;

  @ApiProperty({ nullable: true })
  warehouseId: string | null;

  @ApiProperty()
  status: string;

  @ApiProperty()
  totalItems: number;

  @ApiProperty()
  totalQty: number;

  @ApiProperty()
  totalReservedQty: number;

  @ApiProperty({ type: FulfillmentV2ProgressDto })
  progress: FulfillmentV2ProgressDto;

  @ApiProperty({ type: [FulfillmentV2ShipmentSummaryDto] })
  shipments: FulfillmentV2ShipmentSummaryDto[];

  @ApiProperty({ type: [FulfillmentOrderItemDto] })
  items: FulfillmentOrderItemDto[];

  @ApiProperty({ type: [ReservationSummaryDto] })
  reservations: ReservationSummaryDto[];
}

export class FulfillmentOrderListResponseDto {
  @ApiProperty({ description: '출고주문 목록', type: [FulfillmentOrderResponseDto] })
  data: FulfillmentOrderResponseDto[];

  @ApiProperty({ description: '전체 개수 (필터 적용 후)' })
  total: number;
}
