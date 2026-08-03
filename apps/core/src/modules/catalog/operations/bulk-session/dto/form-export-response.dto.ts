import { ApiProperty } from '@nestjs/swagger';

export class FormExportAcceptedDto {
  @ApiProperty() exportId: string;
  @ApiProperty({ enum: ['queued'] }) status: 'queued';
  @ApiProperty({ description: '요청한 상품 수' }) requestedCount: number;
}

export class FormExportStatusDto {
  @ApiProperty() exportId: string;
  @ApiProperty({ enum: ['queued', 'running', 'completed', 'failed'] })
  status: 'queued' | 'running' | 'completed' | 'failed';
  @ApiProperty({ description: '실제로 프리필된 상품 수. active 버전이 없는 상품은 빠진다' })
  productCount: number;
  @ApiProperty({ required: false, nullable: true }) errorMessage: string | null;
  @ApiProperty({ description: '완료 시에만 true' }) downloadable: boolean;
  @ApiProperty() expiresAt: string;
}

export class FormExportDownloadDto {
  @ApiProperty() url: string;
}
