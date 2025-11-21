import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, MinLength, MaxLength } from 'class-validator';

export class CreateChannelCategoryDto {
  @ApiProperty({ description: '분류명', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: '분류 설명', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '정렬 순서', required: false, default: 0 })
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}

