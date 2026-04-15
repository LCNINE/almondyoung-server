import { ApiProperty } from '@nestjs/swagger';

export class TransferJobLineDto {
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
    example: 'Transfer from WH1 to WH2',
    nullable: true,
  })
  memo: string | null;

  @ApiProperty({
    description: '생성 일시',
    example: '2025-10-20T08:00:00Z',
  })
  createdAt: string;
}

export class BaseTransferJobDto {
  @ApiProperty({
    description: '작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: '창고 ID',
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
    example: 'Monthly rebalancing',
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

export class TransferJobWithLinesDto extends BaseTransferJobDto {
  @ApiProperty({
    description: '작업 라인 목록',
    type: [TransferJobLineDto],
    required: false,
  })
  lines?: TransferJobLineDto[];
}

export class TransferJobWithLineCountDto extends BaseTransferJobDto {
  @ApiProperty({
    description: '작업 라인 개수',
    example: 10,
  })
  lineCount: number;
}

export class CreateTransferJobResponseDto {
  @ApiProperty({
    description: '작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  jobId: string;

  @ApiProperty({
    description: 'Journal ID',
    example: '550e8400-e29b-41d4-a716-446655440100',
  })
  journalId: string;

  @ApiProperty({
    description: '생성된 라인 목록',
    type: [TransferJobLineDto],
  })
  lines: TransferJobLineDto[];
}

export class ExecuteTransferJobResponseDto {
  @ApiProperty({
    description: '작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  jobId: string;

  @ApiProperty({
    description: '실행된 라인 개수',
    example: 5,
  })
  linesExecuted: number;
}

export class MoveWithinWarehouseResponseDto {
  @ApiProperty({
    description: '작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  jobId: string;

  @ApiProperty({
    description: 'Journal ID',
    example: '550e8400-e29b-41d4-a716-446655440100',
  })
  journalId: string;
}

export class TransferJobStatusDto {
  @ApiProperty({
    description: '작업 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  jobId: string;

  @ApiProperty({
    description: '전체 라인 개수',
    example: 10,
  })
  total: number;

  @ApiProperty({
    description: '실행 완료된 라인 개수',
    example: 7,
  })
  executed: number;

  @ApiProperty({
    description: '대기 중인 라인 개수',
    example: 3,
  })
  pending: number;

  @ApiProperty({
    description: '작업 상태',
    enum: ['pending', 'in_progress', 'completed'],
    example: 'in_progress',
  })
  status: string;
}

export class TransferJobListResponseDto {
  @ApiProperty({
    description: '이동 작업 목록',
    type: [TransferJobWithLineCountDto],
  })
  jobs: TransferJobWithLineCountDto[];

  @ApiProperty({
    description: '총 개수',
    example: 25,
  })
  total: number;

  @ApiProperty({
    description: '페이지 크기',
    example: 50,
  })
  limit: number;

  @ApiProperty({
    description: '오프셋',
    example: 0,
  })
  offset: number;
}
