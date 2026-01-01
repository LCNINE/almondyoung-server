import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/shared/dto';

export const REVIEW_RATING_FILTERS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  'positive',
  'negative',
] as const;

export type ReviewRatingFilter = typeof REVIEW_RATING_FILTERS[number];

export class ReviewListQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: '상품 ID (UUID)',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsUUID()
  productId: string;

  @ApiPropertyOptional({
    description: '평점 필터 (1~5 또는 positive/negative)',
    enum: REVIEW_RATING_FILTERS,
    example: 'positive',
  })
  @IsOptional()
  @IsIn(REVIEW_RATING_FILTERS)
  rating?: ReviewRatingFilter;
}
