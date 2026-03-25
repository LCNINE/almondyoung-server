import { ApiProperty } from '@nestjs/swagger';

export class ProductImageDto {
  @ApiProperty({ description: '이미지 ID (UUID)' })
  id: string;

  @ApiProperty({ description: '제품 버전 ID (UUID)' })
  versionId: string;

  @ApiProperty({ description: '파일 ID (UUID)' })
  fileId: string;

  @ApiProperty({ description: '대표 이미지 여부' })
  isPrimary: boolean;

  @ApiProperty({ description: '정렬 순서', minimum: 0 })
  sortOrder: number;

  @ApiProperty({
    description: '생성일시 (ISO 8601 형식)',
    example: '2025-12-05T10:30:00.000Z',
  })
  createdAt: string;
}

export class ProductImagesDto {
  @ApiProperty({
    description: '대표 이미지',
    type: ProductImageDto,
    required: false,
    nullable: true,
  })
  primary: ProductImageDto | null;

  @ApiProperty({
    description: '추가 이미지 목록',
    type: [ProductImageDto],
  })
  additional: ProductImageDto[];
}
