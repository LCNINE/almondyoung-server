import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, MinLength, MaxLength } from 'class-validator';

export class UpdateChannelCategoryDto {
  @ApiProperty({ description: '분류명', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: '분류 설명', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '정렬 순서', required: false })
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}
