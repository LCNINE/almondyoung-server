import { ApiProperty } from '@nestjs/swagger';
import { AuditLogItemDto } from './audit-log-item.dto';

export class ProductAuditHistoryItemDto extends AuditLogItemDto {
  @ApiProperty({
    description: '변경 사항 (키-값 쌍의 객체)',
    nullable: true,
    required: false,
    example: {
      name: { old: 'Old Name', new: 'New Name' },
      price: { old: 10000, new: 12000 },
    },
  })
  changes?: Record<string, any> | null;
}
