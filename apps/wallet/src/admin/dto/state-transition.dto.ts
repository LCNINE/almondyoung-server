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

  @ApiProperty({ description: 'SYSTEM, USER, ADMIN, WEBHOOK, or COMMAND' })
  triggeredByType: string;

  @ApiPropertyOptional()
  triggeredById: string | null;

  @ApiProperty()
  correlationId: string;

  @ApiProperty()
  occurredAt: Date;
}
