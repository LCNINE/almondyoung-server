import { ApiProperty } from '@nestjs/swagger';
import { AuditLogItemDto } from './audit-log-item.dto';

export class ProductAuditHistoryItemDto extends AuditLogItemDto {
  @ApiProperty({
    description: '변경 사항. 필드마다 { old, new }',
    nullable: true,
    required: false,
    example: {
      name: { old: 'Old Name', new: 'New Name' },
      price: { old: 10000, new: 12000 },
    },
  })
  changes?: Record<string, any> | null;
}
