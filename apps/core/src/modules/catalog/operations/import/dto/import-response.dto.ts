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

  @ApiProperty({ enum: ['created', 'failed'] })
  status: 'created' | 'failed';

  @ApiProperty({ required: false })
  masterId?: string;

  @ApiProperty({ required: false })
  errorMessage?: string;
}

export class CommitResultDto {
  @ApiProperty()
  sessionId: string;

  @ApiProperty()
  createdCount: number;

  @ApiProperty()
  failedCount: number;

  @ApiProperty({ type: [CommitItemDto] })
  items: CommitItemDto[];
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
}

export class SessionDetailDto extends SessionSummaryDto {
  @ApiProperty({ type: [CommitItemDto] })
  items: CommitItemDto[];
}

export class PublishFailureDto {
  @ApiProperty()
  masterId: string;

  @ApiProperty()
  reason: string;
}

export class PublishResultDto {
  @ApiProperty()
  published: number;

  @ApiProperty({ type: [PublishFailureDto] })
  failed: PublishFailureDto[];
}
