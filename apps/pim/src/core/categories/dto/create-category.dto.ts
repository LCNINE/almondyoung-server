import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsInt, Min, MaxLength, IsUrl } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ 
    description: '카테고리 이름',
    minLength: 1,
    maxLength: 255,
    example: '전자제품'
  })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ 
    description: '카테고리 설명',
    required: false,
    example: '다양한 전자제품을 판매합니다'
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ 
    description: 'URL 슬러그',
    required: false,
    example: 'electronics'
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  slug?: string;

  @ApiProperty({ 
    description: '카테고리 이미지 URL',
    required: false,
    example: 'https://example.com/image.jpg'
  })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiProperty({ 
    description: '부모 카테고리 ID (UUID 형식)',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiProperty({ 
    description: '정렬 순서',
    minimum: 0,
    required: false,
    example: 0
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

