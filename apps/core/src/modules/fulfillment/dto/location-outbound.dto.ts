import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNotEmpty, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { LOCATION_OUTBOUND_MAX_QUANTITY } from '../services/location-outbound.service';

export class StartLocationOutboundDto {
  @IsUUID()
  warehouseId: string;
}

export class LocationOutboundScanDto extends StartLocationOutboundDto {
  @IsUUID()
  sourceLocationId: string;

  @IsString()
  @IsNotEmpty()
  barcode: string;

  @IsInt()
  @Min(1)
  @Max(LOCATION_OUTBOUND_MAX_QUANTITY)
  quantity: number;
}

export class LocationOutboundConfirmItemDto {
  @IsUUID()
  shipmentLineId: string;

  @IsUUID()
  sourceLocationId: string;

  @IsInt()
  @Min(1)
  @Max(LOCATION_OUTBOUND_MAX_QUANTITY)
  quantity: number;
}

export class LocationOutboundConfirmDto extends StartLocationOutboundDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocationOutboundConfirmItemDto)
  items: LocationOutboundConfirmItemDto[];
}
