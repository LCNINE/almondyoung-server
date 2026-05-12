import { ApiProperty } from '@nestjs/swagger';

export class CategoryResponseDto {
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

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;

  @ApiProperty({ description: '하위 카테고리 수', required: false, minimum: 0 })
  childCount?: number;

  @ApiProperty({ description: '해당 카테고리의 제품 수', required: false, minimum: 0 })
  productCount?: number;

  @ApiProperty({ description: '썸네일 이미지 URL', required: false, nullable: true })
  thumbnail?: string | null;

  @ApiProperty({ description: '기본 가격', required: false, nullable: true })
  basePrice?: string | null;
}
