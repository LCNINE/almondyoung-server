import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  MaxLength,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CategoryTagGroupLinkDto } from './category-tag-group-link.dto';

export class UpdateCategoryDto {
  @ApiProperty({
    description: '카테고리 이름',
    minLength: 1,
    maxLength: 255,
    required: false,
    example: '전자제품',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({
    description: '카테고리 설명',
    required: false,
    example: '다양한 전자제품을 판매합니다',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'URL 슬러그',
    required: false,
    example: 'electronics',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  slug?: string;

  @ApiProperty({
    // 값은 file-service fileId(UUID) 를 저장한다 (읽는 쪽에서 file-service URL 을 붙임).
    // 과거 @IsUrl() 이라 fileId 가 400 으로 막혔다. 전체 URL 도 허용하려고 문자열로 둔다.
    description: '카테고리 이미지 (file-service fileId 또는 URL). 빈 문자열이면 제거',
    required: false,
    example: '019df045-8325-7890-abcd-0123456789ab',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiProperty({
    description: '정렬 순서',
    minimum: 0,
    required: false,
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({
    description: '활성 상태',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    description: '태그 그룹 연결 목록',
    type: [CategoryTagGroupLinkDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryTagGroupLinkDto)
  tagGroupLinks?: CategoryTagGroupLinkDto[];
}
