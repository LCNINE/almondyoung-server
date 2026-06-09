import { ApiProperty } from '@nestjs/swagger';

export class InvoiceSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  invoiceNumber: string;

  @ApiProperty({ enum: ['issued', 'printed', 'shipped', 'canceled'] })
  status: string;

  @ApiProperty({ nullable: true })
  carrierCode: string | null;

  @ApiProperty({ enum: ['goodsflow', 'direct', 'self'] })
  issueMethod: string;
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

export class FulfillmentOrderItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  fulfillmentOrderId: string;

  @ApiProperty({ nullable: true })
  salesOrderId: string | null;

  @ApiProperty({ nullable: true })
  salesOrderLineId: string | null;

  @ApiProperty({ nullable: true })
  variantId: string | null;

  @ApiProperty()
  skuId: string;

  @ApiProperty()
  qty: number;

  @ApiProperty()
  reservedQty: number;

  @ApiProperty()
  pickedQty: number;

  @ApiProperty()
  shippedQty: number;

  @ApiProperty()
  status: string;
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

  @ApiProperty({ type: ShipmentSummaryDto, nullable: true })
  shipment?: ShipmentSummaryDto | null;

  @ApiProperty({ type: BatchSummaryDto, nullable: true })
  batch?: BatchSummaryDto | null;

  @ApiProperty({ type: [FulfillmentOrderItemDto] })
  items?: FulfillmentOrderItemDto[];

  @ApiProperty({ type: [ReservationSummaryDto] })
  reservations?: ReservationSummaryDto[];

  @ApiProperty({
    type: [String],
    description: '관리자가 실행할 수 있는 액션 목록. UI는 이 목록 기반으로만 버튼을 활성화한다.',
  })
  adminAvailableActions?: string[];

  @ApiProperty({
    type: [String],
    description: '액션이 차단된 사유 목록. UI에서 disabled reason으로 표시한다.',
  })
  blockedReasons?: string[];
}
