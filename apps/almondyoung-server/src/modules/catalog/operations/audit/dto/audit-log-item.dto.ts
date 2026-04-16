import { ApiProperty } from '@nestjs/swagger';

export class AuditLogItemDto {
  @ApiProperty({ description: '감사 로그 ID' })
  id: string;

  @ApiProperty({ description: '제품 마스터 ID' })
  productId: string;

  @ApiProperty({ description: '액션 타입 (예: CREATE, UPDATE, DELETE)' })
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
