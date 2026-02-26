import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class RatingSummaryQueryDto {
  @ApiProperty({
    description: '상품 ID (UUID)',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsUUID()
  productId: string;
}

export class RatingSummaryResponseDto {
  @ApiProperty({
    description: '상품 ID',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  productId: string;

  @ApiProperty({ description: '평균 평점', example: 4.3 })
  averageRating: number;

  @ApiProperty({ description: '총 리뷰 수', example: 128 })
  totalCount: number;

  @ApiProperty({
    description: '평점별 리뷰 수 분포 (1~5)',
    example: { 1: 5, 2: 8, 3: 15, 4: 30, 5: 70 },
  })
  ratingDistribution: Record<number, number>;
}
