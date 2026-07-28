import { ApiProperty } from '@nestjs/swagger';

export class ResolvedPreviewDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ type: [String] })
  categoryNames: string[];

  @ApiProperty()
  variantCount: number;
}

export class ValidatePreviewRowDto {
  @ApiProperty()
  rowNumber: number;

  @ApiProperty()
  productKey: string;

  @ApiProperty({ enum: ['valid', 'invalid'] })
  status: 'valid' | 'invalid';

  @ApiProperty({ type: [String] })
  errors: string[];

  @ApiProperty({ type: ResolvedPreviewDto })
  resolved: ResolvedPreviewDto;
}

export class ValidatePreviewDto {
  @ApiProperty()
  totalRows: number;

  @ApiProperty()
  validCount: number;

  @ApiProperty()
  invalidCount: number;

  @ApiProperty({ type: [ValidatePreviewRowDto] })
  rows: ValidatePreviewRowDto[];
}

export class CommitItemDto {
  @ApiProperty()
  rowNumber: number;

  @ApiProperty()
  productKey: string;

  // 'pending' 은 접수 후 워커가 아직 처리하지 않은 행(비동기 커밋). 동기 커밋 응답에는
  // 나타나지 않지만 getSession() 은 이 DTO 를 재사용해 세션 상세를 돌려주므로 포함한다.
  @ApiProperty({ enum: ['created', 'failed', 'pending'] })
  status: 'created' | 'failed' | 'pending';

  @ApiProperty({ required: false })
  masterId?: string;

  @ApiProperty({ required: false })
  errorMessage?: string;

  @ApiProperty({ enum: ['pending', 'published', 'failed', 'skipped'] })
  publishStatus: 'pending' | 'published' | 'failed' | 'skipped';

  @ApiProperty({ required: false })
  publishError?: string;
}

export class CommitAcceptedDto {
  @ApiProperty({ description: '생성된 임포트 세션 id. 진행 상황은 GET /product-imports/:id 로 폴링한다.' })
  sessionId: string;

  @ApiProperty({ enum: ['queued'] })
  status: 'queued';

  @ApiProperty()
  totalRows: number;

  @ApiProperty({ description: '워커가 처리할 유효 행 수' })
  queuedCount: number;

  @ApiProperty({ description: '검증에서 이미 떨어진 행 수 — 접수 시점의 확정값' })
  invalidCount: number;
}

export class SessionSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ required: false, nullable: true })
  fileName: string | null;

  @ApiProperty()
  totalRows: number;

  @ApiProperty()
  createdCount: number;

  @ApiProperty()
  failedCount: number;

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ enum: ['idle', 'queued', 'running', 'completed', 'failed'], description: '상품 생성 잡 상태' })
  commitStatus: string;

  @ApiProperty({ enum: ['idle', 'queued', 'running', 'completed', 'failed'], description: '게시 잡 상태' })
  publishStatus: string;

  @ApiProperty()
  publishedCount: number;

  @ApiProperty()
  publishFailedCount: number;

  @ApiProperty({ required: false, nullable: true })
  commitError: string | null;

  @ApiProperty({ required: false, nullable: true })
  publishError: string | null;
}

export class SessionDetailDto extends SessionSummaryDto {
  @ApiProperty({ type: [CommitItemDto] })
  items: CommitItemDto[];
}

export class PublishAcceptedDto {
  @ApiProperty()
  sessionId: string;

  @ApiProperty({ enum: ['queued'] })
  status: 'queued';

  @ApiProperty({ description: '게시 대상 행 수. 진행은 GET /product-imports/:id 로 폴링한다.' })
  targetCount: number;
}
