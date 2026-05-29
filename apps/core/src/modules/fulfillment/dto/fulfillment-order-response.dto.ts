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
}
