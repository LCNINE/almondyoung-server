import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/shared/dto';
import { REVIEW_SORT_OPTIONS, type ReviewSortOption } from './review-list-query.dto';

export class MyReviewListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '상품 ID 필터 (UUID)',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    description: '정렬 옵션',
    enum: REVIEW_SORT_OPTIONS,
    example: 'latest',
    default: 'latest',
  })
  @IsOptional()
  @IsIn(REVIEW_SORT_OPTIONS)
  sort?: ReviewSortOption;
}
