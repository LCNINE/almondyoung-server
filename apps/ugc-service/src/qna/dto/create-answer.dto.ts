import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateAnswerDto {
  @ApiProperty({ description: '답변 내용', example: '안녕하세요, M사이즈 실측은 ...' })
  @IsString()
  @MinLength(1)
  content: string;
}
