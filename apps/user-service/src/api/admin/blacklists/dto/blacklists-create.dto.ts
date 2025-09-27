import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class BlacklistsCreateDto {
  @ApiProperty({
    description: '사용자 ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID()
  @IsOptional()
  userId: string;

  @ApiProperty({
    description: '블랙리스트 사유',
    example: '반복적인 허위 신고',
  })
  @IsString()
  reason: string;

  @ApiPropertyOptional({
    description: 'CS팀 내부 메모',
    example: '2024년 3월부터 지속적인 문제 제기',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  internalNote?: string;
}
