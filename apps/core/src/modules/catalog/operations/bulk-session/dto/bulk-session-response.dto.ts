import { ApiProperty } from '@nestjs/swagger';

/** productBulkSessionPhaseEnum 전량. 4·5단계 값도 지금 다 노출한다 — schema 주석과 같은 이유. */
const BULK_SESSION_PHASES = [
  'uploaded',
  'validating',
  'review',
  'awaiting_images',
  'drafting',
  'drafted',
  'publishing',
  'published',
  'canceled',
  'failed',
] as const;

export class BulkSessionAcceptedDto {
  @ApiProperty() sessionId: string;
  @ApiProperty({ enum: ['uploaded'] }) phase: 'uploaded';
  @ApiProperty({ description: '"상품" 시트 데이터 행 수' }) totalRows: number;
}

export class BulkSessionSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() fileName: string;
  @ApiProperty({ enum: BULK_SESSION_PHASES }) phase: string;
  @ApiProperty({ required: false, nullable: true }) phaseError: string | null;
  @ApiProperty({ description: '"상품" 시트 데이터 행 수(합성 아이템 제외)' }) totalRows: number;
  @ApiProperty({ required: false, nullable: true }) cancelRequestedAt: Date | null;
  @ApiProperty() createdAt: Date;
}

export class BulkSessionListDto {
  @ApiProperty({ type: [BulkSessionSummaryDto] }) data: BulkSessionSummaryDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class BulkSessionItemStatusCountDto {
  @ApiProperty({ enum: ['pending', 'invalid', 'drafted', 'excluded', 'failed'] }) status: string;
  @ApiProperty() count: number;
}

export class BulkSessionImageStatusCountDto {
  @ApiProperty({ enum: ['resolved', 'awaiting_upload'] }) status: string;
  @ApiProperty() count: number;
}

export class BulkSessionProgressDto {
  @ApiProperty() sessionId: string;
  @ApiProperty({ enum: BULK_SESSION_PHASES }) phase: string;
  @ApiProperty({ required: false, nullable: true }) phaseError: string | null;
  @ApiProperty({
    description:
      '"상품" 시트 데이터 행 수. 진행률 분모로 쓰지 마라 — 합성 아이템(고아 참조 등)이 빠져 있어 아이템 수와 어긋난다.',
  })
  totalRows: number;
  @ApiProperty({ description: 'itemCounts 의 합 — 진행률의 올바른 분모는 이것이다(totalRows 가 아니다).' })
  itemTotal: number;
  @ApiProperty({ type: [BulkSessionItemStatusCountDto], description: '아이템 status 별 실시간 집계(카운터 컬럼 아님)' })
  itemCounts: BulkSessionItemStatusCountDto[];
  @ApiProperty({
    type: [BulkSessionImageStatusCountDto],
    description: '이미지 status 별 실시간 집계(카운터 컬럼 아님)',
  })
  imageCounts: BulkSessionImageStatusCountDto[];
  @ApiProperty({ required: false, nullable: true }) cancelRequestedAt: Date | null;
}

export class BulkSessionItemChangeDto {
  @ApiProperty() field: string;
  @ApiProperty({ description: '서버가 붙인 워크북 한국어 헤더 라벨' }) label: string;
  @ApiProperty() before: string;
  @ApiProperty() after: string;
}

export class BulkSessionItemConflictDto {
  @ApiProperty() field: string;
  @ApiProperty({ description: '서버가 붙인 워크북 한국어 헤더 라벨' }) label: string;
  @ApiProperty() base: string;
  @ApiProperty() mine: string;
  @ApiProperty() current: string;
  @ApiProperty({ enum: ['overwrite', 'skip'], nullable: true, description: '미결정이면 null' })
  decision: 'overwrite' | 'skip' | null;
}

export class BulkSessionItemDto {
  @ApiProperty({ description: 'PATCH .../items/:itemId/conflict-decision 에 쓰는 id' }) id: string;
  @ApiProperty() rowNumber: number;
  @ApiProperty() rowKey: string;
  @ApiProperty({ enum: ['create', 'update'] }) kind: 'create' | 'update';
  @ApiProperty({ enum: ['pending', 'invalid', 'drafted', 'excluded', 'failed'] }) status: string;
  @ApiProperty({ required: false, nullable: true }) masterId: string | null;
  @ApiProperty({ required: false, nullable: true }) errorMessage: string | null;
  @ApiProperty({ type: [BulkSessionItemChangeDto], description: '이 행이 실제로 바꾸는 것' })
  changes: BulkSessionItemChangeDto[];
  @ApiProperty({
    type: [BulkSessionItemConflictDto],
    description: '사람이 결정해야 하는 것만. 비어 있으면 승인에 걸림돌이 없다.',
  })
  conflicts: BulkSessionItemConflictDto[];
}

export class BulkSessionItemListDto {
  @ApiProperty({ type: [BulkSessionItemDto] }) data: BulkSessionItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
