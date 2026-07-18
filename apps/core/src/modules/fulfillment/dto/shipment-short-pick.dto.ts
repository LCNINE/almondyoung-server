import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export const SHIPMENT_SHORT_PICK_REASONS = [
  'inventory_shortage',
  'item_damaged',
  'quality_defect',
  'expired_stock',
] as const;

export type ShipmentShortPickReason = (typeof SHIPMENT_SHORT_PICK_REASONS)[number];

export class ShipmentShortPickLineDto {
  @IsUUID()
  shipmentLineId: string;

  @IsUUID()
  sourceLocationId: string;

  @IsInt()
  @Min(1)
  expectedLineVersion: number;

  @IsInt()
  @Min(1)
  shortQty: number;
}

export class ReportShipmentShortPickDto {
  @IsUUID()
  workItemId: string;

  @IsInt()
  @Min(0)
  expectedWorkItemLeaseVersion: number;

  @IsUUID()
  planId: string;

  @IsInt()
  @Min(1)
  expectedPlanVersion: number;

  @IsUUID()
  sessionId: string;

  @IsInt()
  @Min(1)
  expectedSessionVersion: number;

  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShipmentShortPickLineDto)
  lines: ShipmentShortPickLineDto[];

  @IsIn(SHIPMENT_SHORT_PICK_REASONS)
  reason: ShipmentShortPickReason;

  @IsUUID()
  @IsOptional()
  csCaseId?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  note?: string;
}

export type ShipmentShortPickActor = { id: string; roles: string[] };

export class ShipmentShortPickResponseDto {
  @ApiProperty()
  operationId: string;

  @ApiProperty()
  shipmentId: string;

  @ApiProperty({ enum: ['pending', 'recovery_required', 'completed'] })
  operationStatus: 'pending' | 'recovery_required' | 'completed';

  @ApiPropertyOptional({ nullable: true })
  invoiceOperationId: string | null;

  @ApiProperty()
  workItemId: string;
}
