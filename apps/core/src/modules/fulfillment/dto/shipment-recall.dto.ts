import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

export const SHIPMENT_RECALL_REASONS = [
  'carrier_handoff_failed',
  'dispatch_mistake',
  'address_correction',
  'package_recovered',
] as const;

export type ShipmentRecallReason = (typeof SHIPMENT_RECALL_REASONS)[number];

export class RecallShipmentDispatchDto {
  @IsUUID()
  dispatchAttemptId: string;

  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @ApiProperty({
    description: 'The exact dispatched package is physically back under warehouse custody',
    example: true,
  })
  @IsBoolean()
  @Equals(true)
  physicalRecoveryConfirmed: true;

  @ApiProperty({ enum: SHIPMENT_RECALL_REASONS })
  @IsIn(SHIPMENT_RECALL_REASONS)
  reason: ShipmentRecallReason;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  csCaseId?: string;

  @ApiPropertyOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(2_000)
  @IsOptional()
  note?: string;
}

export type ShipmentRecallActor = { id: string; roles: string[] };

export class ShipmentRecallResponseDto {
  @ApiProperty()
  operationId: string;

  @ApiProperty()
  shipmentId: string;

  @ApiProperty()
  dispatchAttemptId: string;

  @ApiProperty({ enum: ['pending', 'recovery_required', 'completed'] })
  operationStatus: 'pending' | 'recovery_required' | 'completed';

  @ApiPropertyOptional({ nullable: true })
  invoiceOperationId: string | null;
}
