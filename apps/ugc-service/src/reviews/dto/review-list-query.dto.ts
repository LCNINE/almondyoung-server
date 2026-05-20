import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/shared/dto';

export const REVIEW_RATING_FILTERS = ['1', '2', '3', '4', '5', 'positive', 'negative'] as const;

export type ReviewRatingFilter = (typeof REVIEW_RATING_FILTERS)[number];

export const REVIEW_SORT_OPTIONS = ['latest', 'oldest', 'rating_high', 'rating_low'] as const;

export type ReviewSortOption = (typeof REVIEW_SORT_OPTIONS)[number];

export const REVIEW_TYPE_OPTIONS = ['all', 'photo', 'text'] as const;
export type ReviewTypeOption = (typeof REVIEW_TYPE_OPTIONS)[number];

// 'deleted'는 enum 값이 아니라 어드민 목록의 필터 옵션(삭제됨=deletedAt IS NOT NULL)
export const REVIEW_STATUS_FILTERS = ['active', 'hidden', 'deleted'] as const;
export type ReviewStatusFilter = (typeof REVIEW_STATUS_FILTERS)[number];

export const REVIEW_HAS_COMMENT_FILTERS = ['true', 'false'] as const;
export type ReviewHasCommentFilter = (typeof REVIEW_HAS_COMMENT_FILTERS)[number];

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
    description: '리뷰 타입 필터 (photo: 사진 포함, text: 텍스트만)',
    enum: REVIEW_TYPE_OPTIONS,
    default: 'all',
  })
  @IsOptional()
  @IsIn(REVIEW_TYPE_OPTIONS)
  type?: ReviewTypeOption;
}

// 관리자용 전체 리뷰 조회
export class AdminReviewListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '상태 필터 (미지정 시 삭제됨 제외, deleted 지정 시 삭제됨만)',
    enum: REVIEW_STATUS_FILTERS,
  })
  @IsOptional()
  @IsIn(REVIEW_STATUS_FILTERS)
  status?: ReviewStatusFilter;

  @ApiPropertyOptional({
    description: '평점 필터 (1~5 또는 positive/negative)',
    enum: REVIEW_RATING_FILTERS,
  })
  @IsOptional()
  @IsIn(REVIEW_RATING_FILTERS)
  rating?: ReviewRatingFilter;

  @ApiPropertyOptional({
    description: '상품 ID (UUID 전체 또는 부분 문자열). 어드민 검색용으로 부분 매칭(ILIKE) 지원.',
    example: 'f7b98c38',
  })
  @IsOptional()
  productId?: string;

  @ApiPropertyOptional({
    description: '어드민 댓글 작성 여부 ("true"=작성됨, "false"=미작성)',
    enum: REVIEW_HAS_COMMENT_FILTERS,
  })
  @IsOptional()
  @IsIn(REVIEW_HAS_COMMENT_FILTERS)
  hasComment?: ReviewHasCommentFilter;

  @ApiPropertyOptional({
    description: '정렬 옵션',
    enum: REVIEW_SORT_OPTIONS,
    default: 'latest',
  })
  @IsOptional()
  @IsIn(REVIEW_SORT_OPTIONS)
  sort?: ReviewSortOption;

  @ApiPropertyOptional({
    description: '검색어 (본문, 작성자명)',
  })
  @IsOptional()
  q?: string;
}
