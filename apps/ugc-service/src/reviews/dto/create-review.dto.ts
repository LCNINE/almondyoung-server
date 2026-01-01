import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, Max, IsString, MinLength } from 'class-validator';

export class CreateReviewDto {
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
}
