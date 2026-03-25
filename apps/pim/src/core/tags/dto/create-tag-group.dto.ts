import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, MaxLength, IsBoolean } from 'class-validator';

export class CreateTagGroupDto {
  @ApiProperty({
    description: '태그 그룹 이름',
    minLength: 1,
    maxLength: 100,
    example: '컬 모양',
  })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: '태그 그룹 설명',
    required: false,
    example: '속눈썹 컬의 모양을 나타내는 태그',
  })
  @IsOptional()
  @IsString()
  description?: string;

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
