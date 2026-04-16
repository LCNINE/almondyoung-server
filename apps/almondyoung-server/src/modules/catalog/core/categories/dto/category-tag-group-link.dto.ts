import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsBoolean, IsOptional, Min } from 'class-validator';

export class CategoryTagGroupLinkDto {
  @ApiProperty({
    description: '태그 그룹 ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  tagGroupId: string;

  @ApiProperty({
    description: '표시 순서',
    minimum: 0,
    required: false,
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiProperty({
    description: '필수 여부',
    required: false,
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiProperty({
    description: '하위 카테고리에도 적용 여부',
    required: false,
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  appliesToDescendants?: boolean;
}
