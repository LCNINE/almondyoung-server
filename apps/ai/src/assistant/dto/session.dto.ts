import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SessionSummaryDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ nullable: true }) title: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ChatMessageDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['user', 'assistant'] }) role: string;
  @ApiPropertyOptional({ nullable: true }) content: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: '모델에게 그대로 되돌려줄 원본(도구 호출·결과 포함). 화면은 보통 볼 일이 없다.',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  contentBlocks: unknown[] | null;
  @ApiPropertyOptional({
    nullable: true,
    description: '이 턴에 실행된 도구. 패널이 카드로 렌더한다.',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  toolCalls: unknown[] | null;
  @ApiProperty() createdAt: Date;
}

export class DeletedDto {
  @ApiProperty({ example: true }) deleted: boolean;
}
