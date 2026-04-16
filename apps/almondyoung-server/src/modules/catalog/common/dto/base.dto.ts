import { ApiProperty } from '@nestjs/swagger';

/**
 * Base timestamps for all entities
 * createdAt and updatedAt are always present (NOT NULL)
 * All dates are in ISO 8601 format (string type in JSON)
 */
export abstract class BaseTimestampsDto {
  @ApiProperty({
    description: '생성일시 (ISO 8601 형식)',
    example: '2025-12-05T10:30:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: '수정일시 (ISO 8601 형식)',
    example: '2025-12-05T10:30:00.000Z',
  })
  updatedAt: string;
}

/**
 * Soft deletable entities
 * Extends base timestamps and adds deletedAt field
 */
export abstract class SoftDeletableDto extends BaseTimestampsDto {
  @ApiProperty({
    description: '삭제일시 (ISO 8601 형식, 삭제되지 않은 경우 null)',
    example: '2025-12-05T10:30:00.000Z',
    nullable: true,
  })
  deletedAt: string | null;
}
