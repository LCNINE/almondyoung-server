import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsBoolean, IsOptional, IsArray, ArrayMaxSize, IsUUID } from 'class-validator';
import { MAX_QUESTION_MEDIA_COUNT } from '../constants';

export class UpdateQuestionDto {
  @ApiPropertyOptional({ description: '질문 제목', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: '질문 내용' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  content?: string;

  @ApiPropertyOptional({ description: '비밀글 여부' })
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
