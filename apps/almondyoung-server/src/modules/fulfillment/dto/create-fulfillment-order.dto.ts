import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsOptional, IsArray, IsNumber, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AddressDto } from './address.dto';

export class CreateFulfillmentOrderItemDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: 'Quantity', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: 'Variant ID (PIM)', required: false })
  @IsUUID()
  @IsOptional()
  variantId?: string;

  @ApiProperty({ description: 'Sales Order Line ID', required: false })
  @IsUUID()
  @IsOptional()
  salesOrderLineId?: string;

  @ApiProperty({ description: 'Mapping Snapshot ID', required: false })
  @IsUUID()
  @IsOptional()
  mappingSnapshotId?: string;
}

/** @deprecated Use CreateFulfillmentOrderItemDto instead */
export class CreateFulfillmentOrderLineDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: 'Quantity', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class CreateFulfillmentOrderDto {
  @ApiProperty({ description: 'Sales Order ID', required: false })
  @IsUUID()
  @IsOptional()
  salesOrderId?: string;

  @ApiProperty({ description: 'Warehouse ID', required: false })
  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @ApiProperty({ description: 'Owner ID (for 3PL)', required: false })
  @IsUUID()
  @IsOptional()
  ownerId?: string;

  @ApiProperty({ description: 'Shipping address', type: AddressDto, required: false })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  shippingAddress?: AddressDto;

  @ApiProperty({ description: 'Order items', type: [CreateFulfillmentOrderItemDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFulfillmentOrderItemDto)
  @IsOptional()
  items?: CreateFulfillmentOrderItemDto[];

  /** @deprecated Use items instead */
  @ApiProperty({
    description: 'Order lines (deprecated, use items instead)',
    type: [CreateFulfillmentOrderLineDto],
    required: false,
    deprecated: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFulfillmentOrderLineDto)
  @IsOptional()
  lines?: CreateFulfillmentOrderLineDto[];
}
