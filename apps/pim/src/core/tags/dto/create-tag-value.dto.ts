import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, MaxLength, IsBoolean, IsUUID } from 'class-validator';

export class CreateTagValueDto {
  @ApiProperty({
    description: '태그 그룹 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  groupId: string;

  @ApiProperty({
    description: '태그 값 이름',
    minLength: 1,
    maxLength: 100,
    example: 'C컬',
  })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: '표시 순서',
    minimum: 0,
    required: false,
    default: 0,
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiProperty({
    description: '활성 상태',
    required: false,
    default: true,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

