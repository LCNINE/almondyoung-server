import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class EditCsCommentDto {
  @ApiProperty({ description: '수정할 본문' })
  @IsString()
  body: string;
}
