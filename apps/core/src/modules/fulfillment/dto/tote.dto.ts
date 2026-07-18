import { IsInt, IsNotEmpty, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

const PHYSICAL_TOTE_BARCODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class RegisterToteDto {
  @IsUUID()
  warehouseId: string;

  @IsString()
  @Matches(PHYSICAL_TOTE_BARCODE)
  toteBarcode: string;
}

export class AssignToteDto {
  @IsUUID()
  batchId: string;

  @IsUUID()
  planId: string;

  @IsUUID()
  sessionId: string;

  @IsUUID()
  workItemId: string;

  @IsUUID()
  shipmentId: string;

  @IsString()
  @Matches(PHYSICAL_TOTE_BARCODE)
  toteBarcode: string;

  @IsInt()
  @Min(0)
  expectedLeaseVersion: number;
}

export class ToteScanDto extends AssignToteDto {
  @IsUUID()
  shipmentLineId: string;

  @IsUUID()
  skuId: string;

  @IsUUID()
  sourceLocationId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class ToteHandoffDto extends AssignToteDto {
  @IsUUID()
  targetWorkItemId: string;

  @IsUUID()
  targetShipmentId: string;

  @IsInt()
  @Min(0)
  targetExpectedLeaseVersion: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  reason: string;
}

export class ReleaseToteDto extends AssignToteDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  reason: string;
}
