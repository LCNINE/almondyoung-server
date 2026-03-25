import { ApiProperty } from '@nestjs/swagger';
import {
  IsUUID,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  Min,
  ValidateNested,
  ArrayMinSize,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CustomerDto } from '../../shared/dto/customer.dto';
import { AddressDto } from '../../shared/dto/address.dto';

export class CreateSalesOrderLineDto {
  @ApiProperty({ description: 'Product variant ID' })
  @IsUUID()
  @IsNotEmpty()
  variantId: string;

  @ApiProperty({ description: 'Product matching ID', required: false })
  @IsUUID()
  @IsOptional()
  productMatchingId?: string;

  @ApiProperty({ description: 'Product name', required: false })
  @IsString()
  @IsOptional()
  productName?: string;

  @ApiProperty({ description: 'Quantity', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: 'Unit price', required: false })
  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  @ApiProperty({ description: 'Total price', required: false })
  @IsNumber()
  @IsOptional()
  totalPrice?: number;
}

export class CreateSalesOrderDto {
  @ApiProperty({ description: 'Channel order ID' })
  @IsString()
  @IsNotEmpty()
  channelOrderId: string;

  @ApiProperty({ description: 'Sales channel' })
  @IsString()
  @IsNotEmpty()
  salesChannel: string;

  @ApiProperty({
    description: 'Customer information',
    type: CustomerDto,
    required: false,
  })
  @ValidateNested()
  @Type(() => CustomerDto)
  @IsOptional()
  customer?: CustomerDto;

  @ApiProperty({
    description: 'Shipping address',
    type: AddressDto,
  })
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress: AddressDto;

  @ApiProperty({ description: 'Shipping address hash', required: false })
  @IsString()
  @IsOptional()
  shippingAddressHash?: string;

  @ApiProperty({ description: 'Total amount', required: false })
  @IsNumber()
  @IsOptional()
  totalAmount?: number;

  @ApiProperty({ description: 'Shipping fee', required: false, default: 0 })
  @IsNumber()
  @IsOptional()
  shippingFee?: number;

  @ApiProperty({ description: 'Merge group ID', required: false })
  @IsString()
  @IsOptional()
  mergeGroupId?: string;

  @ApiProperty({
    description: 'Order date',
    required: false,
    type: String,
    format: 'date-time',
  })
  @IsDateString()
  @IsOptional()
  orderDate?: string;

  @ApiProperty({
    description: 'Order lines',
    type: [CreateSalesOrderLineDto],
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderLineDto)
  lines: CreateSalesOrderLineDto[];
}
