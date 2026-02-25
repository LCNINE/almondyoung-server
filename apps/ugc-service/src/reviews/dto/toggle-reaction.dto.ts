import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class ToggleReactionDto {
  @ApiProperty({
    description: '반응 타입',
    enum: ['helpful', 'like', 'dislike'],
    example: 'helpful',
  })
  @IsString()
  @IsIn(['helpful', 'like', 'dislike'])
  type: 'helpful' | 'like' | 'dislike';
}
