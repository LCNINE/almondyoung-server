import { ApiProperty } from '@nestjs/swagger';
import { SALES_CHANNELS } from '@packages/event-contracts/streams';
import type { OrderShipmentPhase } from '../services/order-shipment-phase.sql';

export class SalesOrderLineResponseDto {
  @ApiProperty({ description: '주문 라인 ID' })
  id: string;

  @ApiProperty({ description: '판매 주문 ID' })
  salesOrderId: string;

  @ApiProperty({ description: 'Product variant ID (PIM)' })
  variantId: string;

  // 상세·목록 응답만 채운다(라인 조회가 술어를 함께 select 한다)
  @ApiProperty({
    description: '매칭 해결 여부 — 라인 구성을 굳혔거나 상품매칭이 실물/void 로 해결됨(#1063)',
    required: false,
  })
  matchingResolved?: boolean;

  @ApiProperty({ description: '상품명' })
  productName: string;

  @ApiProperty({ description: '수량' })
  quantity: number;

  @ApiProperty({ description: '단가', nullable: true })
  unitPrice: number | null;

  @ApiProperty({ description: '총 가격', nullable: true })
  totalPrice: number | null;

  @ApiProperty({ description: '생성 일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정 일시' })
  updatedAt: Date;
}

export class BusinessLinkReferenceResponseDto {
  @ApiProperty({ description: '도메인 엔티티 타입' })
  type: string;

  @ApiProperty({ description: 'Core 내부 UUID', nullable: true })
  id: string | null;

  @ApiProperty({ description: '외부 서비스 안정 참조값', nullable: true })
  externalRef: string | null;
}

export class BusinessTimelineEffectStatusDto {
  @ApiProperty({ description: '상태 소유 도메인. 예: wallet' })
  owner: string;

  @ApiProperty({ description: '소유 도메인이 제공한 상태값. 예: SUCCEEDED, FAILED, PENDING' })
  value: string;
}

export class SalesOrderBusinessTimelineItemDto {
  @ApiProperty({ description: 'Business Link ID' })
  id: string;

  @ApiProperty({ description: '관계명' })
  relationName: string;

  @ApiProperty({ description: 'SalesOrder 기준 방향', enum: ['outbound', 'inbound'] })
  direction: 'outbound' | 'inbound';

  @ApiProperty({ description: 'source 참조', type: BusinessLinkReferenceResponseDto })
  source: BusinessLinkReferenceResponseDto;

  @ApiProperty({ description: 'target 참조', type: BusinessLinkReferenceResponseDto })
  target: BusinessLinkReferenceResponseDto;

  @ApiProperty({ description: 'SalesOrder 반대편 엔티티 참조', type: BusinessLinkReferenceResponseDto })
  linkedEntity: BusinessLinkReferenceResponseDto;

  @ApiProperty({ description: '부가 정보' })
  metadata: Record<string, unknown>;

  @ApiProperty({
    description: '연결된 효과의 상태. 주문 lifecycle 상태와 별도로 대상 도메인이 소유한다.',
    type: BusinessTimelineEffectStatusDto,
    nullable: true,
  })
  effectStatus: BusinessTimelineEffectStatusDto | null;

  @ApiProperty({ description: '업무 사건 발생 시각' })
  occurredAt: Date;

  @ApiProperty({ description: '링크 생성 시각' })
  createdAt: Date;
}

export class SalesOrderResponseDto {
  @ApiProperty({ description: '판매 주문 ID' })
  id: string;

  @ApiProperty({ description: '채널별 주문 ID' })
  channelOrderId: string;

  @ApiProperty({
    description: '고객에게 보여주는 주문번호 (Medusa display_id 등). 채널이 주지 않으면 null — 이때는 channelOrderId 가 곧 고객 주문번호다.',
    nullable: true,
  })
  displayOrderNo: string | null;

  @ApiProperty({ description: '판매 채널', enum: SALES_CHANNELS })
  salesChannel: string;

  @ApiProperty({ description: 'Wallet 결제 인텐트 ID (결제 상세 연결용)', nullable: true })
  walletIntentId: string | null;

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
    description:
      '출고 단계 — 일별 통계와 같은 정의 한 벌. pending 미확정 / preparing 준비 중 / shipping 배송 중 / delivered 배송 완료 / external_shipped core 밖(셀메이트)에서 출고 / cancelled 취소',
    enum: ['pending', 'preparing', 'shipping', 'delivered', 'external_shipped', 'cancelled'],
  })
  shipmentPhase: OrderShipmentPhase;

  @ApiProperty({ description: '주문 라인 목록', type: [SalesOrderLineResponseDto] })
  lines: SalesOrderLineResponseDto[];

  @ApiProperty({ description: '업무 연결 timeline', type: [SalesOrderBusinessTimelineItemDto] })
  businessTimeline: SalesOrderBusinessTimelineItemDto[];
}
