import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ description: '댓글 내용', example: '소중한 리뷰 감사합니다.' })
  @IsString()
  @MinLength(1)
  content: string;
}
