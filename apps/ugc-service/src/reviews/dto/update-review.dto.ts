import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, Max, IsString, MinLength } from 'class-validator';

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
}
