import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, Max, IsString, MinLength, IsArray, IsOptional, ArrayMaxSize } from 'class-validator';
import { MAX_REVIEW_MEDIA_COUNT } from '../constants';

export class CreateReviewDto {
  @ApiProperty({
    description: '리뷰 작성 자격 ID (UUID)',
    example: 'a1b2c3d4-5e6f-7890-abcd-ef1234567890',
  })
  @IsUUID()
  eligibilityId: string;

  @ApiProperty({
    description: '상품 ID (UUID)',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsUUID()
  productId: string;

  @ApiProperty({ description: '평점', minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({ description: '리뷰 본문', example: '아주 만족합니다.' })
  @IsString()
  @MinLength(1)
  content: string;

  @ApiPropertyOptional({
    description: '첨부 미디어 파일 ID 목록',
    type: [String],
    maxItems: MAX_REVIEW_MEDIA_COUNT,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REVIEW_MEDIA_COUNT)
  @IsUUID('all', { each: true })
  mediaFileIds?: string[];
}
