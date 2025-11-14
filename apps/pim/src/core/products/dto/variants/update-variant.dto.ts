import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUrl, IsArray, IsEnum, IsNumber, IsPositive, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class DimensionsDto {
  @ApiProperty({ description: '길이 (cm)', minimum: 0 })
  @IsNumber()
  @IsPositive()
  length: number;

  @ApiProperty({ description: '너비 (cm)', minimum: 0 })
  @IsNumber()
  @IsPositive()
  width: number;

  @ApiProperty({ description: '높이 (cm)', minimum: 0 })
  @IsNumber()
  @IsPositive()
  height: number;
}

export class UpdateProductVariantDto {
  @ApiProperty({ 
    description: '제품 변형 이름',
    minLength: 1,
    required: false
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiProperty({ description: 'SKU 코드', required: false })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty({ description: '변형 속성 (색상, 사이즈 등)', required: false })
  @IsOptional()
  attributes?: Record<string, any>;

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

  @ApiProperty({ description: '무게 (g)', minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  weight?: number;

  @ApiProperty({ description: '치수 정보', type: DimensionsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => DimensionsDto)
  dimensions?: DimensionsDto;
}

export class UpdateVariantStatusDto {
  @ApiProperty({ 
    description: '새로운 변형 상태',
    enum: ['active', 'inactive']
  })
  @IsEnum(['active', 'inactive'])
  status: 'active' | 'inactive';
}

