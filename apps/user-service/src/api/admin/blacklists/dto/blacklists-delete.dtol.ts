import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDate, IsUUID } from 'class-validator';

export class BlacklistsDeleteDto {
  @ApiProperty({
    description: '사용자 ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({
    description: '해제한 일시',
    example: '2024-01-01T00:00:00Z',
    nullable: true,
  })
  @IsDate()
  deletedAt: Date;

  @ApiPropertyOptional({
    description: '해제한 관리자 ID',
    example: '123e4567-e89b-12d3-a456-426614174002',
    nullable: true,
  })
  @IsUUID()
  deletedBy: string;
}
