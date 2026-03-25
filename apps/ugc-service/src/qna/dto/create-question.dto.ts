import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsString, MinLength, MaxLength, IsBoolean, IsOptional, IsArray, ArrayMaxSize, IsIn } from 'class-validator';
import { MAX_QUESTION_MEDIA_COUNT, QUESTION_CATEGORIES, type QuestionCategory } from '../constants';

export class CreateQuestionDto {
  @ApiProperty({ description: '작성자 닉네임', example: '홍길동', maxLength: 30 })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  nickname: string;

  @ApiPropertyOptional({
    description: '상품 ID (UUID) - 상품 문의일 때 필수',
    example: 'f7b98c38-2d6f-4b37-8b6b-2f68b1c15b0a',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    description: '문의 카테고리 - 1:1 문의일 때 사용',
    enum: QUESTION_CATEGORIES,
    example: 'delivery',
  })
  @IsOptional()
  @IsIn(QUESTION_CATEGORIES)
  category?: QuestionCategory;

  @ApiPropertyOptional({
    description: '세부 문의 유형 - 1:1 문의일 때 사용',
    example: 'status',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  subCategory?: string;

  @ApiProperty({ description: '질문 제목', example: '사이즈 문의드립니다', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiProperty({ description: '질문 내용', example: '이 제품 M사이즈 실측이 어떻게 되나요?' })
  @IsString()
  @MinLength(1)
  content: string;

  @ApiPropertyOptional({ description: '비밀글 여부', default: false })
  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;

  @ApiPropertyOptional({
    description: '첨부 미디어 파일 ID 목록',
    type: [String],
    maxItems: MAX_QUESTION_MEDIA_COUNT,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_QUESTION_MEDIA_COUNT)
  @IsUUID('all', { each: true })
  mediaFileIds?: string[];
}
