import { ApiProperty } from '@nestjs/swagger';
import { CategoryResponseDto } from './category-response.dto';

export class CategoryDetailResponseDto {
  @ApiProperty({ description: '카테고리 ID' })
  id: string;

  @ApiProperty({ description: '카테고리 이름' })
  name: string;

  @ApiProperty({ description: '카테고리 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'URL 슬러그' })
  slug: string;

  @ApiProperty({ description: '부모 카테고리 ID', nullable: true })
  parentId: string | null;

  @ApiProperty({ description: '카테고리 레벨 (깊이)', minimum: 0 })
  level: number;

  @ApiProperty({ description: '카테고리 경로' })
  path: string;

  @ApiProperty({ description: '정렬 순서', minimum: 0 })
  sortOrder: number;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시' })
  createdAt: string;

  @ApiProperty({ description: '수정일시' })
  updatedAt: string;

  @ApiProperty({
    description: '부모 카테고리 정보',
    type: CategoryResponseDto,
    required: false,
  })
  parent?: CategoryResponseDto;

  @ApiProperty({
    description: '하위 카테고리 목록',
    type: [CategoryResponseDto],
  })
  children: CategoryResponseDto[];

  @ApiProperty({ description: '직계 하위 카테고리의 제품 수', minimum: 0 })
  productCount: number;

  @ApiProperty({ description: '모든 하위 카테고리 포함 전체 제품 수', minimum: 0 })
  totalProductCount: number;

  @ApiProperty({ description: '썸네일 이미지 URL', required: false, nullable: true })
  thumbnail?: string | null;
}
