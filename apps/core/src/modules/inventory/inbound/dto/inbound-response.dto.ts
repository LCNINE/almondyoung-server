import type { ReceiptActionBlockReason } from './inbound-receipt-state.dto';
import { ApiProperty } from '@nestjs/swagger';

export class InboundReceiptLineDto {
  @ApiProperty({
    description: '라인 ID',
    example: '550e8400-e29b-41d4-a716-446655440010',
  })
  id: string;

  @ApiProperty({
    description: '입고 Receipt ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  receiptId: string;

  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  skuId: string;

  @ApiProperty({
    description: '수량',
    example: 50,
  })
  quantity: number;

  @ApiProperty({
    description: '원위치 로케이션 ID',
    example: '550e8400-e29b-41d4-a716-446655440020',
    nullable: true,
  })
  originLocationId: string | null;

  @ApiProperty({
    description: '재고 이벤트 ID',
    example: '550e8400-e29b-41d4-a716-446655440030',
    nullable: true,
  })
  eventId: string | null;

  @ApiProperty({
    description: '메모',
    example: 'Individual inbound test',
    nullable: true,
  })
  memo: string | null;

  @ApiProperty({
    description: '회송 수량',
    example: 0,
  })
  returnedQty: number;

  @ApiProperty({
    description: '취소 수량',
    example: 0,
  })
  canceledQty: number;

  @ApiProperty({
    description: '원위치에서 적치된 수량',
    example: 0,
  })
  putawayFromOriginQty: number;

  @ApiProperty({
    description: '입고 출처',
    enum: ['direct', 'purchase_order'],
    example: 'direct',
  })
  source: 'direct' | 'purchase_order';

  @ApiProperty({
    description: '생성 일시',
    example: '2025-12-13T19:30:04.272Z',
  })
  createdAt: string;

  @ApiProperty({
    description: '수정 일시',
    example: '2025-12-13T19:30:04.272Z',
  })
  updatedAt: string;
}

export class BaseInboundReceiptDto {
  @ApiProperty({
    description: 'Receipt ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: '입고 방식',
    enum: ['individual', 'simple', 'simple_fullscan', 'planned'],
    example: 'individual',
  })
  method: string;

  @ApiProperty({
    description: '창고 ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  warehouseId: string;

  @ApiProperty({
    description: '로케이션 ID',
    example: '550e8400-e29b-41d4-a716-446655440020',
    nullable: true,
  })
  locationId: string | null;

  @ApiProperty({
    description: '발생 일시',
    example: '2025-12-13T19:30:04.000Z',
  })
  occurredAt: string;

  @ApiProperty({
    description: '상태',
    enum: ['posted', 'voided'],
    example: 'posted',
  })
  status: 'posted' | 'voided';

  @ApiProperty({
    description: '총 수량',
    example: 50,
  })
  totalQuantity: number;

  @ApiProperty({
    description: 'Journal ID',
    example: '550e8400-e29b-41d4-a716-446655440100',
    nullable: true,
  })
  journalId: string | null;

  @ApiProperty({
    description: '생성 일시',
    example: '2025-12-13T19:30:04.272Z',
  })
  createdAt: string;

  @ApiProperty({
    description: '수정 일시',
    example: '2025-12-13T19:30:04.272Z',
  })
  updatedAt: string;
}

export class IndividualInboundResponseDto extends BaseInboundReceiptDto {
  @ApiProperty({
    description: '입고 라인',
    type: InboundReceiptLineDto,
  })
  line: InboundReceiptLineDto;
}

export class SimpleInboundResponseDto extends BaseInboundReceiptDto {
  @ApiProperty({
    description: '입고 라인 목록',
    type: [InboundReceiptLineDto],
  })
  lines: InboundReceiptLineDto[];
}

export type InboundCancelBlockReason =
  | 'ALREADY_CANCELED'
  | 'NOT_TODAY'
  | 'PUTAWAY_EXISTS'
  | 'RETURN_EXISTS'
  | 'INSUFFICIENT_ORIGIN_STOCK'
  | 'MISSING_ORIGIN_OR_EVENT';

export class InboundReceiptHistoryLineDto extends InboundReceiptLineDto {
  @ApiProperty({ description: '미처리 입고 수량' })
  pendingQty: number;

  @ApiProperty({ description: '조회 시점의 적치 가능 여부' })
  canPutaway: boolean;

  @ApiProperty({ description: '적치 차단 사유', nullable: true })
  putawayBlockReason: ReceiptActionBlockReason | null;

  @ApiProperty({ description: '상품 코드' })
  skuCode: string;

  @ApiProperty({ description: '상품명' })
  skuName: string;

  @ApiProperty({ description: '원위치 코드', nullable: true })
  originLocationCode: string | null;

  @ApiProperty({ description: '조회 시점의 취소 가능 여부' })
  canCancel: boolean;

  @ApiProperty({
    description: '조회 시점의 취소 차단 사유',
    nullable: true,
    enum: [
      'ALREADY_CANCELED',
      'NOT_TODAY',
      'PUTAWAY_EXISTS',
      'RETURN_EXISTS',
      'INSUFFICIENT_ORIGIN_STOCK',
      'MISSING_ORIGIN_OR_EVENT',
    ],
  })
  cancelBlockReason: InboundCancelBlockReason | null;
}

export class InboundReceiptHistoryItemDto extends BaseInboundReceiptDto {
  @ApiProperty({ description: '회차의 전체 입고 라인', type: [InboundReceiptHistoryLineDto] })
  lines: InboundReceiptHistoryLineDto[];
}

export class InboundReceiptHistoryResponseDto {
  @ApiProperty({ description: '서버 응답 생성 시각', example: '2026-09-15T00:00:00.000Z' })
  serverTime: string;

  @ApiProperty({ description: '필터에 맞는 회차 수', example: 2 })
  total: number;

  @ApiProperty({ type: [InboundReceiptHistoryItemDto] })
  items: InboundReceiptHistoryItemDto[];
}
