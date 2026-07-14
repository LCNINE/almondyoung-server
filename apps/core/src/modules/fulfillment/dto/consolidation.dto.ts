import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from './address.dto';

export class ConsolidationCandidateQueryDto {
  @IsUUID()
  warehouseId: string;

  @IsUUID()
  @IsOptional()
  sourceShipmentId?: string;
}

export class ConsolidationSourceDto {
  @IsUUID()
  shipmentId: string;

  @IsInt()
  @Min(1)
  expectedManifestVersion: number;

  @IsInt()
  @Min(1)
  expectedReservationVersion: number;
}

export class CreateConsolidationDto {
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => ConsolidationSourceDto)
  sources: ConsolidationSourceDto[];

  @IsUUID()
  @IsOptional()
  recipientSourceShipmentId?: string;

  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  recipientSnapshot?: AddressDto;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsUUID()
  @IsOptional()
  csCaseId?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export type ConsolidationActor = {
  id: string;
  roles: string[];
};
