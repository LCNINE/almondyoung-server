import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

export class ShipmentInspectionScanDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(256)
  barcode: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class ForceShipmentDispatchDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  reason: string;

  @IsUUID()
  @IsOptional()
  csCaseId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2_000)
  note?: string;
}

export type ShipmentDispatchActor = {
  id: string;
  roles: string[];
};
