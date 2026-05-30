import { ApiProperty } from '@nestjs/swagger';
import { SalesOrderAmendmentDeltaDto } from './create-sales-order-amendment.dto';

export class SalesOrderAmendmentResponseDto {
  @ApiProperty({ description: 'SalesOrderAmendment ID' })
  id: string;

  @ApiProperty({ description: 'SalesOrder ID' })
  salesOrderId: string;

  @ApiProperty({ description: 'Commercial impact classification', enum: ['commercial', 'fulfillment_only'] })
  amendmentKind: string;

  @ApiProperty({ description: 'Operator decision', enum: ['approved', 'rejected', 'pending'] })
  decision: string;

  @ApiProperty({ description: 'Reason code', nullable: true })
  reasonCode: string | null;

  @ApiProperty({ description: 'Operator note', nullable: true })
  note: string | null;

  @ApiProperty({ description: 'Typed amendment deltas', type: [SalesOrderAmendmentDeltaDto] })
  deltas: SalesOrderAmendmentDeltaDto[];

  @ApiProperty({ description: 'Metadata' })
  metadata: Record<string, unknown>;

  @ApiProperty({ description: 'Operator user ID', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: 'Business event time' })
  occurredAt: Date;

  @ApiProperty({ description: 'Created time' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated time' })
  updatedAt: Date;
}
