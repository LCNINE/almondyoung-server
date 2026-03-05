import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewEligibilityResponseDto {
  @ApiProperty({ description: '리뷰 자격 ID' })
  id: string;

  @ApiProperty({ description: '사용자 ID' })
  userId: string;

  @ApiProperty({ description: '상품 ID' })
  productId: string;

  @ApiProperty({ description: '주문 ID' })
  orderId: string;

  @ApiProperty({ description: '주문 라인 ID' })
  orderLineId: string;

  @ApiProperty({
    description: '리뷰 작성 가능 일시 (ISO 8601)',
    example: '2025-12-05T10:30:00.000Z',
  })
  eligibleAt: string;

  @ApiPropertyOptional({
    description: '리뷰 작성 완료 일시 (ISO 8601)',
    nullable: true,
    example: '2025-12-10T14:00:00.000Z',
  })
  consumedAt: string | null;

  @ApiPropertyOptional({
    description: '작성된 리뷰 ID',
    nullable: true,
  })
  consumedByReviewId: string | null;

  @ApiProperty({
    description: '생성일시 (ISO 8601)',
    example: '2025-12-05T10:30:00.000Z',
  })
  createdAt: string;
}
