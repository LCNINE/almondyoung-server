import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { carrierValues, CarrierEnum } from '../../../inventory/schema/enum-values';

export class IssueWaybillDto {
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsIn(carrierValues)
  carrier: CarrierEnum;
}

export class RegisterManualWaybillDto {
  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsIn(carrierValues)
  carrier: CarrierEnum;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  trackingNo: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class VoidWaybillDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class IssueBatchWaybillDto {
  @IsString({ each: true })
  shipmentIds: string[];

  @IsIn(carrierValues)
  carrier: CarrierEnum;
}

export class WaybillResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  shipmentId: string;

  @ApiProperty({ enum: ['carrier', 'manual'] })
  source: string;

  @ApiProperty()
  carrier: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional({ nullable: true })
  trackingNo: string | null;

  @ApiPropertyOptional({ nullable: true })
  custOrdNo: string | null;

  @ApiProperty()
  manifestVersion: number;

  @ApiPropertyOptional({ nullable: true })
  issuedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  voidedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastError: string | null;
}

export class BatchResultItemDto {
  @ApiProperty()
  shipmentId: string;

  @ApiProperty()
  status: string; // registered | failed | pending | allocated

  @ApiPropertyOptional({ nullable: true })
  trackingNo: string | null;

  @ApiPropertyOptional({ nullable: true })
  reason: string | null;
}

export type WaybillActor = { id: string; roles: string[] };
