import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsOptional, IsArray, IsNumber, Min, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { AddressDto } from '../../shared/dto/address.dto';

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

  @ApiProperty({ 
    description: 'Shipping address',
    type: AddressDto,
    required: false
  })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  shippingAddress?: AddressDto;

  @ApiProperty({ 
    description: 'Order lines',
    type: [CreateFulfillmentOrderLineDto],
    minItems: 1
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateFulfillmentOrderLineDto)
  lines: CreateFulfillmentOrderLineDto[];
}

