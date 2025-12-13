import { ApiProperty } from '@nestjs/swagger';

export class MovementJobLineDto {
  @ApiProperty({
    description: '라인 ID',
    example: '550e8400-e29b-41d4-a716-446655440010',
  })
  id: string;

  @ApiProperty({
    description: '작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  jobId: string;

  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  skuId: string;

  @ApiProperty({
    description: '수량',
    example: 10,
  })
  quantity: number;

  @ApiProperty({
    description: '출발 위치 ID',
    example: '550e8400-e29b-41d4-a716-446655440020',
    nullable: true,
  })
  fromLocationId: string | null;

  @ApiProperty({
    description: '도착 위치 ID',
    example: '550e8400-e29b-41d4-a716-446655440021',
    nullable: true,
  })
  toLocationId: string | null;

  @ApiProperty({
    description: '재고 이벤트 ID',
    example: '550e8400-e29b-41d4-a716-446655440030',
    nullable: true,
  })
  eventId: string | null;

  @ApiProperty({
    description: '메모',
    example: 'Move to better location',
    nullable: true,
  })
  memo: string | null;

  @ApiProperty({
    description: '생성 일시',
    example: '2025-10-20T08:00:00Z',
  })
  createdAt: string;
}

export class BaseMovementJobDto {
  @ApiProperty({
    description: '작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: '창고 ID (동일 창고 내 이동)',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  warehouseId: string;

  @ApiProperty({
    description: '발생 일시',
    example: '2025-10-20T08:00:00Z',
  })
  occurredAt: string;

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
    description: '작업자 ID',
    example: '550e8400-e29b-41d4-a716-446655440200',
    nullable: true,
  })
  actorId: string | null;

  @ApiProperty({
    description: '메모',
    example: 'Daily location optimization',
    nullable: true,
  })
  memo: string | null;

  @ApiProperty({
    description: '생성 일시',
    example: '2025-10-20T08:00:00Z',
  })
  createdAt: string;

  @ApiProperty({
    description: '수정 일시',
    example: '2025-10-20T09:00:00Z',
  })
  updatedAt: string;
}

export class MovementJobWithLinesDto extends BaseMovementJobDto {
  @ApiProperty({
    description: '작업 라인 목록',
    type: [MovementJobLineDto],
  })
  lines: MovementJobLineDto[];
}

export class MovementWorkLogDto {
  @ApiProperty({
    description: '로그 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: '작업 유형',
    enum: ['MOVE', 'TRANSFER'],
    example: 'MOVE',
  })
  type: string;

  @ApiProperty({
    description: '타임스탬프',
    example: '2025-10-20T08:00:00Z',
  })
  timestamp: string;

  @ApiProperty({
    description: '작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440010',
    nullable: true,
  })
  jobId: string | null;

  @ApiProperty({
    description: '라인 ID',
    example: '550e8400-e29b-41d4-a716-446655440020',
    nullable: true,
  })
  lineId: string | null;

  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
    nullable: true,
  })
  skuId: string | null;

  @ApiProperty({
    description: '창고 ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
    nullable: true,
  })
  warehouseId: string | null;

  @ApiProperty({
    description: '출발 위치 ID',
    example: '550e8400-e29b-41d4-a716-446655440030',
    nullable: true,
  })
  fromLocationId: string | null;

  @ApiProperty({
    description: '도착 위치 ID',
    example: '550e8400-e29b-41d4-a716-446655440031',
    nullable: true,
  })
  toLocationId: string | null;

  @ApiProperty({
    description: '수량',
    example: 10,
    nullable: true,
  })
  quantity: number | null;

  @ApiProperty({
    description: '이벤트 ID',
    example: '550e8400-e29b-41d4-a716-446655440040',
    nullable: true,
  })
  eventId: string | null;

  @ApiProperty({
    description: '사유',
    example: 'Location optimization',
    nullable: true,
  })
  reason: string | null;
}

export class MovementHistoryResponseDto {
  @ApiProperty({
    description: '이동 히스토리 목록',
    type: [MovementWorkLogDto],
  })
  logs: MovementWorkLogDto[];

  @ApiProperty({
    description: '조회 기간 (일)',
    example: 7,
  })
  days: number;

  @ApiProperty({
    description: '총 개수',
    example: 25,
  })
  total: number;
}

