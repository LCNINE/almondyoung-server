import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUrl, IsArray, IsEnum, IsNumber, IsPositive, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';


export class UpdateProductVariantDto {
  @ApiProperty({
    description: '제품 변형 이름',
    minLength: 1,
    required: false
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  variantName?: string;

  @ApiProperty({ description: '변형별 이미지 URL 배열', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  images?: string[];

  @ApiProperty({
    description: '변형 상태',
    enum: ['active', 'inactive'],
    required: false
  })
  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class UpdateVariantStatusDto {
  @ApiProperty({
    description: '새로운 변형 상태',
    enum: ['active', 'inactive']
  })
  @IsEnum(['active', 'inactive'])
  status: 'active' | 'inactive';
}

