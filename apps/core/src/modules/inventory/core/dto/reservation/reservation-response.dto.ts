import { ApiProperty } from '@nestjs/swagger';

export class ReservationDto {
  @ApiProperty({
    description: '예약 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: '예약 대상 타입',
    enum: ['FULFILLMENT_ORDER'],
    example: 'FULFILLMENT_ORDER',
  })
  targetType: 'FULFILLMENT_ORDER';

  @ApiProperty({
    description: '예약 대상 ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  targetId: string;

  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  skuId: string;

  @ApiProperty({
    description: '창고 ID',
    example: '550e8400-e29b-41d4-a716-446655440003',
  })
  warehouseId: string;

  @ApiProperty({
    description: '예약 수량',
    example: 10,
  })
  quantity: number;

  @ApiProperty({
    description: '예약 상태',
    enum: ['pending', 'confirmed', 'released', 'active'],
    example: 'confirmed',
  })
  status: string;

  @ApiProperty({
    description: 'Fulfillment Order Item ID',
    example: '550e8400-e29b-41d4-a716-446655440004',
    nullable: true,
  })
  fulfillmentOrderItemId: string | null;

  @ApiProperty({
    description: '예약 만료 시간',
    example: '2025-10-21T10:00:00Z',
    nullable: true,
  })
  timeoutAt: Date | null;

  @ApiProperty({
    description: '예약 사유',
    example: 'Customer order reservation',
    nullable: true,
  })
  reason: string | null;

  @ApiProperty({
    description: '생성 일시',
    example: '2025-10-20T08:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: '수정 일시',
    example: '2025-10-20T08:30:00Z',
  })
  updatedAt: Date;
}

export class ReservationSummaryTargetDto {
  @ApiProperty({
    description: '대상 타입',
    example: 'FULFILLMENT_ORDER',
  })
  targetType: string;

  @ApiProperty({
    description: '대상 ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  targetId: string;

  @ApiProperty({
    description: '수량',
    example: 10,
  })
  quantity: number;
}

export class ReservationSummaryDto {
  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  skuId: string;

  @ApiProperty({
    description: '창고 ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  warehouseId: string;

  @ApiProperty({
    description: '총 예약 수량',
    example: 50,
  })
  totalReserved: number;

  @ApiProperty({
    description: '대상별 예약 현황',
    type: [ReservationSummaryTargetDto],
  })
  byTarget: ReservationSummaryTargetDto[];
}
