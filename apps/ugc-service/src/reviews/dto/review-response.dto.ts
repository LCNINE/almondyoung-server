import { ApiProperty } from '@nestjs/swagger';

export class ReviewResponseDto {
  @ApiProperty({ description: '리뷰 ID' })
  id: string;

  @ApiProperty({
    description: '사용자 ID',
    nullable: true,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  userId: string | null;

  @ApiProperty({
    description: '상품 ID',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  productId: string;

  @ApiProperty({ description: '평점', minimum: 1, maximum: 5 })
  rating: number;

  @ApiProperty({ description: '리뷰 본문' })
  content: string;

  @ApiProperty({ description: '상태', example: 'active' })
  status: string;

  @ApiProperty({
    description: '생성일시 (ISO 8601 형식)',
    example: '2025-12-05T10:30:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: '수정일시 (ISO 8601 형식)',
    example: '2025-12-05T10:30:00.000Z',
  })
  updatedAt: string;
}
