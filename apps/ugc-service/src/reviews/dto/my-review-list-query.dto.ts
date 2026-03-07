import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/shared/dto';
import { REVIEW_SORT_OPTIONS, type ReviewSortOption } from './review-list-query.dto';

export const REVIEW_PERIOD_OPTIONS = ['6months', '1year', 'all'] as const;
export type ReviewPeriodOption = (typeof REVIEW_PERIOD_OPTIONS)[number];

export const REVIEW_TYPE_OPTIONS = ['all', 'photo', 'text'] as const;
export type ReviewTypeOption = (typeof REVIEW_TYPE_OPTIONS)[number];

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

  @ApiPropertyOptional({
    description: '기간 필터',
    enum: REVIEW_PERIOD_OPTIONS,
    example: '6months',
    default: 'all',
  })
  @IsOptional()
  @IsIn(REVIEW_PERIOD_OPTIONS)
  period?: ReviewPeriodOption;

  @ApiPropertyOptional({
    description: '리뷰 타입 필터 (photo: 사진/동영상 포함, text: 텍스트만)',
    enum: REVIEW_TYPE_OPTIONS,
    example: 'all',
    default: 'all',
  })
  @IsOptional()
  @IsIn(REVIEW_TYPE_OPTIONS)
  type?: ReviewTypeOption;
}
