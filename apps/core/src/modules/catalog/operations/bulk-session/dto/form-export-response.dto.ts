import { ApiProperty } from '@nestjs/swagger';

export class FormExportAcceptedDto {
  @ApiProperty() exportId: string;
  @ApiProperty({ enum: ['queued', 'running'] }) status: 'queued' | 'running';
  @ApiProperty({ description: '요청한 상품 수' }) requestedCount: number;
  @ApiProperty({ description: '진행 중인 같은 요청을 재사용했으면 true' }) reused: boolean;
}

export class FormExportStatusDto {
  @ApiProperty() exportId: string;
  @ApiProperty({ enum: ['queued', 'running', 'completed', 'failed'] })
  status: 'queued' | 'running' | 'completed' | 'failed';
  @ApiProperty({ description: '실제로 프리필된 상품 수. active 버전이 없는 상품은 빠진다' })
  productCount: number;
  @ApiProperty({ required: false, nullable: true }) errorMessage: string | null;
  @ApiProperty({ description: '연속 실패 횟수. running 인데 0 보다 크면 재시도 대기 중이다' })
  consecutiveFailures: number;
  @ApiProperty({ description: '완료 시에만 true' }) downloadable: boolean;
  @ApiProperty() expiresAt: string;
}

export class FormExportDownloadDto {
  @ApiProperty() url: string;
}

export class FormExportSummaryDto {
  @ApiProperty() exportId: string;
  @ApiProperty({ enum: ['queued', 'running', 'completed', 'failed'] })
  status: 'queued' | 'running' | 'completed' | 'failed';
  @ApiProperty({ description: '요청한 상품 수' }) requestedCount: number;
  @ApiProperty({ description: '실제로 프리필된 상품 수' }) productCount: number;
  @ApiProperty({ required: false, nullable: true }) errorMessage: string | null;
  @ApiProperty({ description: '연속 실패 횟수. running 인데 0 보다 크면 재시도 대기 중이다' })
  consecutiveFailures: number;
  @ApiProperty() downloadable: boolean;
  @ApiProperty() createdAt: string;
  @ApiProperty() expiresAt: string;
}

export class FormExportListDto {
  @ApiProperty({ type: [FormExportSummaryDto] }) data: FormExportSummaryDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
