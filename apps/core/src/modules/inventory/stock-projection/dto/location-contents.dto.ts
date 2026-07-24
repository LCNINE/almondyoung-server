import { ApiProperty } from '@nestjs/swagger';

export class LocationContentItemDto {
  @ApiProperty()
  skuId: string;

  @ApiProperty()
  skuCode: string;

  @ApiProperty()
  skuName: string;

  @ApiProperty({ description: 'ON_HAND | DEFECTIVE | IN_TRANSFER' })
  stockState: string;

  @ApiProperty()
  quantity: number;
}

export class LocationContentsDto {
  @ApiProperty()
  locationId: string;

  @ApiProperty()
  locationCode: string;

  @ApiProperty()
  warehouseId: string;

  @ApiProperty({ type: [LocationContentItemDto] })
  items: LocationContentItemDto[];
}
