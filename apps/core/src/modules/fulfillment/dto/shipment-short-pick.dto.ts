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

/** 결품 로케이션을 뺀 곳에서 다시 채운 몫 — 현장이 그 로케이션으로 가서 집는다. */
export class ShortPickRefillDto {
  @ApiProperty()
  shipmentLineId: string;

  @ApiProperty()
  skuId: string;

  @ApiProperty()
  sourceLocationId: string;

  @ApiProperty()
  locationCode: string;

  @ApiProperty()
  qty: number;
}

/** 못 채운 줄 — 박스가 빠지는 이유. */
export class ShortPickShortageDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  shipmentLineId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  skuId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  skuCode: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  skuName: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  requiredQty: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  shortQty: number | null;

  @ApiProperty({ enum: ['INBOUND_PENDING', 'STOCK_SHORT'] })
  reason: 'INBOUND_PENDING' | 'STOCK_SHORT';
}

export class ShipmentShortPickResponseDto {
  @ApiProperty()
  operationId: string;

  @ApiProperty()
  shipmentId: string;

  @ApiProperty()
  workItemId: string;

  @ApiProperty({ enum: ['pending', 'completed'] })
  operationStatus: 'pending' | 'completed';

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: '항상 null — 옛 비동기 송장 무효화 추적의 자리(클라이언트 계약)',
  })
  invoiceOperationId: null;

  @ApiProperty({
    enum: ['refilled', 'withdrawing', 'exited'],
    description:
      'refilled = 다른 로케이션에서 채움, withdrawing = 집은 몫을 되돌리는 중(오퍼레이션 pending), exited = 그 자리에서 빠짐',
  })
  outcome: 'refilled' | 'withdrawing' | 'exited';

  @ApiProperty({ type: [ShortPickRefillDto] })
  refills: ShortPickRefillDto[];

  @ApiProperty({ type: [ShortPickShortageDto] })
  shortages: ShortPickShortageDto[];
}
