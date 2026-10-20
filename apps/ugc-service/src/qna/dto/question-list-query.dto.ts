import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/shared/dto';
import { QUESTION_CATEGORIES, QUESTION_SOURCES, type QuestionCategory, type QuestionSource } from '../constants';

export const QUESTION_SORT_OPTIONS = ['latest', 'oldest'] as const;
export type QuestionSortOption = (typeof QUESTION_SORT_OPTIONS)[number];

export const QUESTION_ANSWER_STATUS_FILTERS = [
  'answered',
  'unanswered',
] as const;
export type QuestionAnswerStatusFilter =
  (typeof QUESTION_ANSWER_STATUS_FILTERS)[number];

const toBoolean = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
};

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

  @ApiPropertyOptional({
    description: '답변 상태 필터',
    enum: QUESTION_ANSWER_STATUS_FILTERS,
  })
  @IsOptional()
  @IsIn(QUESTION_ANSWER_STATUS_FILTERS)
  answerStatus?: QuestionAnswerStatusFilter;

  @ApiPropertyOptional({
    description: '비밀글 제외 여부',
    type: Boolean,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  excludeSecret?: boolean;

  @ApiPropertyOptional({
    description: '본인 Q&A만 조회 (인증 필요, 비인증 시 빈 결과)',
    type: Boolean,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mineOnly?: boolean;
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

// 관리자용 전체 문의 조회
export class AdminQuestionListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '문의 카테고리 필터',
    enum: QUESTION_CATEGORIES,
  })
  @IsOptional()
  @IsIn(QUESTION_CATEGORIES)
  category?: QuestionCategory;

  @ApiPropertyOptional({
    description: '문의 출처 필터 (product_qna: 상품 Q&A, inquiry: 1:1 문의)',
    enum: QUESTION_SOURCES,
  })
  @IsOptional()
  @IsIn(QUESTION_SOURCES)
  source?: QuestionSource;

  @ApiPropertyOptional({
    description: '상태 필터',
    enum: ['active', 'answered', 'deleted'],
  })
  @IsOptional()
  @IsIn(['active', 'answered', 'deleted'])
  status?: 'active' | 'answered' | 'deleted';

  @ApiPropertyOptional({
    description: '정렬 옵션',
    enum: QUESTION_SORT_OPTIONS,
    default: 'latest',
  })
  @IsOptional()
  @IsIn(QUESTION_SORT_OPTIONS)
  sort?: QuestionSortOption;

  @ApiPropertyOptional({
    description: '검색어 (제목, 내용, 닉네임)',
  })
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({
    description: 'q 와 OR 로 묶을 작성자 ID 목록 (UUID 콤마 구분). 어드민이 아이디·메일·전화번호로 찾은 회원',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsUUID('all', { each: true })
  authorIds?: string[];

  @ApiPropertyOptional({
    description: '작성자(회원) ID (UUID) - 특정 회원의 문의만 조회 시',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
  @ApiPropertyOptional({ description: '작성 시각 하한 (ISO 8601, 포함)' })
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({ description: '작성 시각 상한 (ISO 8601, 포함)' })
  @IsOptional()
  @IsISO8601()
  createdTo?: string;
}
