import { ApiProperty } from '@nestjs/swagger';

export class OrderLastContactDto {
  @ApiProperty({ enum: ['reached', 'no_answer', 'messaged'] }) outcome!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty() at!: string;
  @ApiProperty({ nullable: true, type: String, description: '다시 연락할 날(YYYY-MM-DD)' })
  followUpOn!: string | null;
}

export class OrderCsBriefDto {
  @ApiProperty({ nullable: true, type: String }) customerPhone!: string | null;
  @ApiProperty({ nullable: true, type: String }) recipientName!: string | null;
  @ApiProperty({ nullable: true, type: String }) recipientPhone!: string | null;
  @ApiProperty({ nullable: true, type: Number }) totalAmount!: number | null;
  @ApiProperty({ nullable: true, type: String }) firstItemName!: string | null;
  @ApiProperty({ nullable: true, type: Number }) firstItemQty!: number | null;
  @ApiProperty({ description: '주문 상품 줄 수' }) itemCount!: number;
  @ApiProperty() hasMemo!: boolean;
  @ApiProperty({ nullable: true, type: OrderLastContactDto }) lastContact!: OrderLastContactDto | null;
}

export class OrderCsBoxDto {
  @ApiProperty() shipmentId!: string;
  @ApiProperty() fulfillmentOrderId!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: String }) carrier!: string | null;
  @ApiProperty({ nullable: true, type: String }) trackingNo!: string | null;
  @ApiProperty({ nullable: true, type: String }) shippedAt!: string | null;
}

export class OrderCsOtherOrderDto {
  @ApiProperty() salesOrderId!: string;
  @ApiProperty() orderNo!: string;
  @ApiProperty() channelOrderId!: string;
  @ApiProperty() salesChannel!: string;
  @ApiProperty() orderedAt!: string;
  @ApiProperty({ nullable: true, type: Number }) totalAmount!: number | null;
  @ApiProperty() phase!: string;
  @ApiProperty({ description: '같은 배송지로 온 주문' }) sameAddress!: boolean;
  @ApiProperty({ enum: ['customer', 'phone'], description: '같은 회원이거나 주문자 연락처가 같다' })
  matchedBy!: string;
}

export class OrderCsContextDto {
  @ApiProperty({ type: [OrderCsBoxDto] }) boxes!: OrderCsBoxDto[];
  @ApiProperty({ type: [OrderCsOtherOrderDto], description: '최근 주문부터' }) otherOrders!: OrderCsOtherOrderDto[];
  @ApiProperty({ description: '더 있다(보이는 것은 최근 것뿐)' }) moreOtherOrders!: boolean;
}
