import { ApiProperty } from '@nestjs/swagger';

export type UnshippedOrderProgress = 'not_boxed' | 'waiting' | 'inspecting' | 'inspected' | 'recovery_required';

export class UnshippedOrderDto {
  @ApiProperty()
  fulfillmentOrderItemId: string;

  @ApiProperty({ type: String, nullable: true })
  salesOrderId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'sales_orders.display_order_no → channel_order_id; SO 없으면 null',
  })
  orderNo: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'sales_channels.site = sales_orders.sales_channel의 name; 없으면 null',
  })
  channelName: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'sales_orders.order_date → fulfillment_orders.created_at (결제일 아님)',
  })
  orderedAt: string;

  @ApiProperty({ description: 'orderedAt부터 오늘까지 KST 달력일 차이, 최솟값 0' })
  delayDays: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'sales_orders.customer_name (주문자), PiiResponse 가림 대상',
  })
  customerName: string | null;

  @ApiProperty()
  remainingQuantity: number;

  @ApiProperty({ description: 'fulfillment_order_items.reserved_qty' })
  reservedQuantity: number;

  @ApiProperty({ description: 'reservedQuantity >= remainingQuantity' })
  canShip: boolean;

  @ApiProperty({
    enum: ['not_boxed', 'waiting', 'inspecting', 'inspected', 'recovery_required'],
    description:
      'draft/planned/recovery_required 상자 라인만 사용. 우선순위: recovery_required 상자 있음 → recovery_required; ' +
      '상자 수량 합 < 잔량(라인 없음 포함) → not_boxed; 검수량 0 → waiting; 일부 검수 → inspecting; 전량 검수 → inspected. ' +
      '취소·대체·출고 이후 상자는 제외. 검수는 피킹·포장·송장발행을 뜻하지 않는다.',
  })
  progress: UnshippedOrderProgress;
}

export class UnshippedOrdersResponseDto {
  @ApiProperty({ type: [UnshippedOrderDto] })
  items: UnshippedOrderDto[];
}
