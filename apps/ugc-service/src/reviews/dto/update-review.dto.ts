import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, Max, IsString, MinLength, IsArray, ArrayMaxSize, IsUUID } from 'class-validator';
import { MAX_REVIEW_MEDIA_COUNT } from '../constants';

export class UpdateReviewDto {
  @ApiPropertyOptional({ description: '평점', minimum: 1, maximum: 5, example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: '리뷰 본문', example: '내용을 수정합니다.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  content?: string;

  @ApiPropertyOptional({
    description: '첨부 미디어 파일 ID 목록',
    type: [String],
    maxItems: MAX_REVIEW_MEDIA_COUNT,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REVIEW_MEDIA_COUNT)
  @IsUUID('4', { each: true })
  mediaFileIds?: string[];
}
