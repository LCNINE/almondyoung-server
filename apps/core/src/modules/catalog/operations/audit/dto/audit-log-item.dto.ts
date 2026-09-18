import { ApiProperty } from '@nestjs/swagger';

export class AuditLogItemDto {
  @ApiProperty({ description: '감사 로그 ID' })
  id: string;

  @ApiProperty({ description: '제품 마스터 ID', nullable: true, type: String })
  productId: string | null;

  @ApiProperty({ description: '버전 ID. 마스터 단위 작업이면 null', nullable: true, type: String })
  versionId: string | null;

  @ApiProperty({ description: '액션 타입 (예: created, updated, published, unpublished)' })
  action: string;

  @ApiProperty({ description: '사용자 ID' })
  userId: string;

  @ApiProperty({
    description: '생성일시 (ISO 8601 형식)',
    format: 'date-time',
    example: '2025-12-05T10:30:00.000Z',
  })
  createdAt: string;
}
