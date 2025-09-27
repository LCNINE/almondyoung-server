import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class BlacklistsResponseDto {
  @ApiProperty({
    description: '블랙리스트 ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID()
  id: string;

  @ApiProperty({
    description: '사용자 ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: '블랙리스트 사유',
    example: '반복적인 허위 신고',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({
    description: 'CS팀 내부 메모',
    example: '2024년 3월부터 지속적인 문제 제기',
    nullable: true,
  })
  @IsString()
  @IsOptional()
  internalNote: string | null;

  @ApiPropertyOptional({
    description: '등록한 관리자 ID',
    example: '123e4567-e89b-12d3-a456-426614174002',
    nullable: true,
  })
  @IsUUID()
  @IsOptional()
  createdBy: string | null;

  @ApiProperty({
    description: '생성일시',
    example: '2024-01-01T00:00:00Z',
    type: Date,
  })
  @Type(() => Date)
  @IsDate()
  createdAt: Date;

  @ApiProperty({
    description: '수정일시',
    example: '2024-01-02T00:00:00Z',
    type: Date,
  })
  @Type(() => Date)
  @IsDate()
  updatedAt: Date;

  @ApiPropertyOptional({
    description: '블랙리스트에서 해당 유저 제거일시',
    example: '2024-01-03T00:00:00Z',
    nullable: true,
  })
  @IsDate()
  deletedAt: Date | null;

  @ApiPropertyOptional({
    description: '블랙리스트에서 해당 유저 제거한 관리자 ID',
    example: '123e4567-e89b-12d3-a456-426614174003',
    nullable: true,
  })
  @IsUUID()
  deletedBy: string | null;
}
