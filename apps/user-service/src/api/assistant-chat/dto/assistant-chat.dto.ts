import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AppendMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiPropertyOptional({ description: '사람이 읽는 본문' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({
    description:
      '모델에게 그대로 되돌려줄 수 있는 원본 메시지(도구 호출·결과 포함). 텍스트만 남기면 이전 턴의 fileId 같은 것이 사라져 대화를 못 잇는다.',
  })
  @IsOptional()
  @IsArray()
  contentBlocks?: unknown[];

  @ApiPropertyOptional({ description: '이 턴에 실제로 실행된 도구' })
  @IsOptional()
  @IsArray()
  toolCalls?: unknown[];
}

export class CreateSessionDto {
  @ApiPropertyOptional({ description: '목록에 보여줄 이름. 보통 첫 발화에서 딴다.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
