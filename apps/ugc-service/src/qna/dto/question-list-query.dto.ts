import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/shared/dto';

export const QUESTION_SORT_OPTIONS = ['latest', 'oldest'] as const;
export type QuestionSortOption = (typeof QUESTION_SORT_OPTIONS)[number];

export class QuestionListQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: '상품 ID (UUID)',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsUUID()
  productId: string;

  @ApiPropertyOptional({
    description: '정렬 옵션',
    enum: QUESTION_SORT_OPTIONS,
    default: 'latest',
  })
  @IsOptional()
  @IsIn(QUESTION_SORT_OPTIONS)
  sort?: QuestionSortOption;
}
