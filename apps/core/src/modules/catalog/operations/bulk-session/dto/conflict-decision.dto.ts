import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class ConflictDecisionDto {
  @ApiProperty({
    description:
      '필드경로 → overwrite | skip. 값 검증(overwrite/skip 여부, 그 행이 실제로 충돌 중인 필드인지)은 매니저가 한다 — ' +
      'class-validator 는 객체 모양만 본다.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  decisions: Record<string, 'overwrite' | 'skip'>;
}
