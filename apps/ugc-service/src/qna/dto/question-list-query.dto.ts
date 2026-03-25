import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/shared/dto';
import { QUESTION_CATEGORIES, type QuestionCategory } from '../constants';

export const QUESTION_SORT_OPTIONS = ['latest', 'oldest'] as const;
export type QuestionSortOption = (typeof QUESTION_SORT_OPTIONS)[number];

export class QuestionListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '상품 ID (UUID) - 상품별 문의 조회 시',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    description: '문의 카테고리 필터',
    enum: QUESTION_CATEGORIES,
  })
  @IsOptional()
  @IsIn(QUESTION_CATEGORIES)
  category?: QuestionCategory;

  @ApiPropertyOptional({
    description: '정렬 옵션',
    enum: QUESTION_SORT_OPTIONS,
    default: 'latest',
  })
  @IsOptional()
  @IsIn(QUESTION_SORT_OPTIONS)
  sort?: QuestionSortOption;
}

// 내 문의 목록 조회용
export class MyQuestionListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '문의 카테고리 필터',
    enum: QUESTION_CATEGORIES,
  })
  @IsOptional()
  @IsIn(QUESTION_CATEGORIES)
  category?: QuestionCategory;

  @ApiPropertyOptional({
    description: '정렬 옵션',
    enum: QUESTION_SORT_OPTIONS,
    default: 'latest',
  })
  @IsOptional()
  @IsIn(QUESTION_SORT_OPTIONS)
  sort?: QuestionSortOption;
}
