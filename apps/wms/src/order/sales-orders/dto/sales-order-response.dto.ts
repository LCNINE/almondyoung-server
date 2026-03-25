import { ApiProperty } from '@nestjs/swagger';

export class SalesOrderLineResponseDto {
  @ApiProperty({ description: '주문 라인 ID' })
  id: string;

  @ApiProperty({ description: '판매 주문 ID' })
  salesOrderId: string;

  @ApiProperty({ description: 'Product variant ID (PIM)' })
  variantId: string;

  @ApiProperty({ description: 'Product matching ID', nullable: true })
  productMatchingId: string | null;

  @ApiProperty({ description: 'Mapping snapshot ID', nullable: true })
  mappingSnapshotId: string | null;

  @ApiProperty({ description: '상품명' })
  productName: string;

  @ApiProperty({ description: '수량' })
  quantity: number;

  @ApiProperty({ description: '단가', nullable: true })
  unitPrice: number | null;

  @ApiProperty({ description: '총 가격', nullable: true })
  totalPrice: number | null;

  @ApiProperty({
    description: '주문 아이템 상태',
    enum: ['pending', 'matched', 'stock_deducted', 'stock_unavailable', 'cancelled'],
  })
  status: string;

  @ApiProperty({ description: '제안 수량', nullable: true })
  suggestedQuantity: number | null;

  @ApiProperty({ description: '부족한 SKU 정보', nullable: true })
  unavailableSkuIds: any | null;

  @ApiProperty({ description: '재고 차감 시간', nullable: true })
  deductedAt: Date | null;

  @ApiProperty({ description: '생성 일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정 일시' })
  updatedAt: Date;
}

export class SalesOrderResponseDto {
  @ApiProperty({ description: '판매 주문 ID' })
  id: string;

  @ApiProperty({ description: '채널별 주문 ID' })
  channelOrderId: string;

  @ApiProperty({
    description: '판매 채널',
    enum: ['medusa', 'naver', 'coupang', '3pl'],
  })
  salesChannel: string;

  @ApiProperty({
    description: '주문 상태',
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'timeout'],
  })
  status: string;

  @ApiProperty({ description: '고객명', nullable: true })
  customerName: string | null;

  @ApiProperty({ description: '고객 이메일', nullable: true })
  customerEmail: string | null;

  @ApiProperty({ description: '고객 전화번호', nullable: true })
  customerPhone: string | null;

  @ApiProperty({ description: '배송지 정보' })
  shippingAddress: any;

  @ApiProperty({ description: '배송지 해시', nullable: true })
  shippingAddressHash: string | null;

  @ApiProperty({ description: '총 주문 금액', nullable: true })
  totalAmount: number | null;

  @ApiProperty({ description: '배송비', default: 0 })
  shippingFee: number;

  @ApiProperty({ description: '합배송 그룹 ID', nullable: true })
  mergeGroupId: string | null;

  @ApiProperty({ description: '합배송 여부', default: false })
  isMerged: boolean;

  @ApiProperty({ description: '주문 일시' })
  orderDate: Date;

  @ApiProperty({ description: '확정 일시', nullable: true })
  confirmedAt: Date | null;

  @ApiProperty({ description: '처리 일시', nullable: true })
  processedAt: Date | null;

  @ApiProperty({ description: '메모', nullable: true })
  memo: string | null;

  @ApiProperty({ description: '생성 일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정 일시' })
  updatedAt: Date;

  @ApiProperty({
    description: '주문 라인 목록',
    type: [SalesOrderLineResponseDto],
  })
  lines: SalesOrderLineResponseDto[];
}
