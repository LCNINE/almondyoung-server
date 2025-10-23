import { ApiProperty } from '@nestjs/swagger';

export class ReturnItemDto {
  @ApiProperty({
    description: '반품 아이템 ID',
    example: '550e8400-e29b-41d4-a716-446655440010',
  })
  id: string;

  @ApiProperty({
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  returnId: string;

  @ApiProperty({
    description: 'SKU ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  skuId: string;

  @ApiProperty({
    description: '요청 수량',
    example: 5,
  })
  requestedQuantity: number;

  @ApiProperty({
    description: '입고 수량',
    example: 5,
  })
  receivedQuantity: number;

  @ApiProperty({
    description: 'QC 통과 수량',
    example: 4,
  })
  qcPassedQuantity: number;

  @ApiProperty({
    description: 'QC 실패 수량',
    example: 1,
  })
  qcFailedQuantity: number;

  @ApiProperty({
    description: '재입고 수량',
    example: 4,
  })
  restockedQuantity: number;

  @ApiProperty({
    description: '폐기 수량',
    example: 1,
  })
  disposedQuantity: number;

  @ApiProperty({
    description: '입고 위치 ID',
    example: '550e8400-e29b-41d4-a716-446655440020',
    nullable: true,
  })
  locationId: string | null;

  @ApiProperty({
    description: 'QC 상태',
    enum: ['pending', 'passed', 'failed'],
    example: 'passed',
  })
  qcStatus: string;

  @ApiProperty({
    description: 'QC 결과 사유',
    example: 'Minor damage',
    nullable: true,
  })
  qcReason: string | null;

  @ApiProperty({
    description: '생성 일시',
    example: '2025-10-20T08:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: '수정 일시',
    example: '2025-10-20T10:00:00Z',
  })
  updatedAt: Date;
}

export class ReturnDto {
  @ApiProperty({
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: '주문 ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
    nullable: true,
  })
  orderId: string | null;

  @ApiProperty({
    description: '출하 ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
    nullable: true,
  })
  shipmentId: string | null;

  @ApiProperty({
    description: '창고 ID',
    example: '550e8400-e29b-41d4-a716-446655440003',
  })
  warehouseId: string;

  @ApiProperty({
    description: '반품 상태',
    enum: ['requested', 'received', 'qc_passed', 'qc_failed', 'disposed'],
    example: 'received',
  })
  status: string;

  @ApiProperty({
    description: '반품 사유',
    example: 'Customer changed mind',
    nullable: true,
  })
  returnReason: string | null;

  @ApiProperty({
    description: 'QC 검사 일시',
    example: '2025-10-20T09:00:00Z',
    nullable: true,
  })
  qcInspectedAt: Date | null;

  @ApiProperty({
    description: 'QC 검사자',
    example: 'John Doe',
    nullable: true,
  })
  qcInspectedBy: string | null;

  @ApiProperty({
    description: 'QC 검사 노트',
    example: 'Overall condition acceptable',
    nullable: true,
  })
  qcNotes: string | null;

  @ApiProperty({
    description: '재입고 수량',
    example: 4,
  })
  restockQuantity: number;

  @ApiProperty({
    description: '폐기 수량',
    example: 1,
  })
  disposeQuantity: number;

  @ApiProperty({
    description: '생성 일시',
    example: '2025-10-20T08:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: '수정 일시',
    example: '2025-10-20T10:00:00Z',
  })
  updatedAt: Date;

  @ApiProperty({
    description: '반품 아이템 목록',
    type: [ReturnItemDto],
    required: false,
  })
  items?: ReturnItemDto[];
}

export class CreateReturnResponseDto {
  @ApiProperty({
    description: '생성된 반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  returnId: string;

  @ApiProperty({
    description: '생성된 반품 아이템 목록',
    type: [ReturnItemDto],
  })
  items: ReturnItemDto[];
}

export class ReceiveReturnResponseDto {
  @ApiProperty({
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  returnId: string;

  @ApiProperty({
    description: 'Journal ID',
    example: '550e8400-e29b-41d4-a716-446655440100',
  })
  journalId: string;
}

export class InspectReturnResponseDto {
  @ApiProperty({
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  returnId: string;

  @ApiProperty({
    description: '전체 QC 상태',
    enum: ['qc_passed', 'qc_failed'],
    example: 'qc_passed',
  })
  status: string;
}

export class ProcessReturnResponseDto {
  @ApiProperty({
    description: '반품 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  returnId: string;

  @ApiProperty({
    description: 'Journal ID',
    example: '550e8400-e29b-41d4-a716-446655440100',
  })
  journalId: string;

  @ApiProperty({
    description: '재입고 수량',
    example: 4,
  })
  restocked: number;

  @ApiProperty({
    description: '폐기 수량',
    example: 1,
  })
  disposed: number;
}

export class ReturnListResponseDto {
  @ApiProperty({
    description: '반품 목록',
    type: [ReturnDto],
  })
  returns: ReturnDto[];

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


