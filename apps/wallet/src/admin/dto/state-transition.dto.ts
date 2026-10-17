import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StateTransitionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'INTENT, CHARGE, or REFUND' })
  entityType: string;

  @ApiProperty()
  entityId: string;

  @ApiPropertyOptional()
  previousStatus: string | null;

  @ApiProperty()
  newStatus: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: '전이 사유 코드 (예: KIND_CHANGED)' })
  reasonCode: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: '전이 부가 정보. KIND_CHANGED 는 { fromKind, toKind }',
  })
  payload: Record<string, unknown> | null;

  @ApiProperty({ description: 'SYSTEM, USER, ADMIN, WEBHOOK, or COMMAND' })
  triggeredByType: string;

  @ApiPropertyOptional()
  triggeredById: string | null;

  @ApiProperty()
  correlationId: string;

  @ApiProperty()
  occurredAt: Date;
}
