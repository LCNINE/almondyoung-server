import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsNumber, IsUrl, IsArray, IsEnum, IsPositive, MinLength } from 'class-validator';

export class UpdateProductMasterDto {
  @ApiProperty({ 
    description: '제품 마스터 이름',
    minLength: 1,
    required: false
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiProperty({ description: '제품 설명', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '카테고리 ID (UUID 형식)', required: false })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ description: '브랜드명', required: false })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiProperty({ description: '기본 가격', minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  basePrice?: number;

  @ApiProperty({ description: '제품 이미지 URL 배열', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  images?: string[];

  @ApiProperty({ description: '제품 속성 (키-값 쌍)', required: false })
  @IsOptional()
  attributes?: Record<string, any>;

  @ApiProperty({ 
    description: '제품 상태',
    enum: ['active', 'inactive', 'draft'],
    required: false
  })
  @IsOptional()
  @IsEnum(['active', 'inactive', 'draft'])
  status?: 'active' | 'inactive' | 'draft';
}

