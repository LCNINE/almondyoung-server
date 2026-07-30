import { ApiProperty } from '@nestjs/swagger';

export class ResolvedPreviewDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ type: [String] })
  categoryNames: string[];

  @ApiProperty({ description: '지정된 카테고리 총 개수. categoryNames 는 그중 대표 카테고리의 경로다.' })
  categoryCount: number;

  @ApiProperty({
    description: "판매기간 'YYYY-MM-DD HH:mm ~ YYYY-MM-DD HH:mm' (KST). 지정 없으면 null.",
    nullable: true,
  })
  salesPeriod: string | null;

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
  @ApiProperty({ description: '생성된 임포트 세션 id. 진행 상황은 GET /product-imports/:id/progress 로 폴링한다.' })
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

  @ApiProperty({
    enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'],
    description: '상품 생성 잡 상태',
  })
  commitStatus: string;

  @ApiProperty({
    enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'],
    description: '게시 잡 상태',
  })
  publishStatus: string;

  @ApiProperty()
  publishedCount: number;

  @ApiProperty()
  publishFailedCount: number;

  @ApiProperty({ required: false, nullable: true })
  commitError: string | null;

  @ApiProperty({ required: false, nullable: true })
  publishError: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: '접수 시점 검증실패 행 수. 옛 세션(컬럼 도입 이전)은 null 이다.',
  })
  invalidCount: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: '취소 요청 시각. null 이 아니면 워커가 이 세션을 더 이상 집지 않는다.',
  })
  cancelRequestedAt: Date | null;
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

  @ApiProperty({ description: '게시 대상 행 수. 진행은 GET /product-imports/:id/progress 로 폴링한다.' })
  targetCount: number;
}

export class CancelAcceptedDto {
  @ApiProperty()
  sessionId: string;

  @ApiProperty({
    enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'],
    description: '취소 반영 후 생성 잡 상태. 이미 끝난 레인은 completed 로 남는다.',
  })
  commitStatus: string;

  @ApiProperty({
    enum: ['idle', 'queued', 'running', 'completed', 'failed', 'canceled'],
    description: '취소 반영 후 게시 잡 상태',
  })
  publishStatus: string;

  @ApiProperty({ description: '취소 요청 시각' })
  canceledAt: Date;
}
