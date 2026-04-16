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
    description: '입고예정 아이템 ID',
    example: '550e8400-e29b-41d4-a716-446655440040',
    nullable: true,
  })
  planItemId: string | null;

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
    enum: ['posted', 'draft', 'cancelled'],
    example: 'posted',
  })
  status: string;

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
