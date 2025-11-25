import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsString, IsArray, IsNumber, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { CustomerDto } from '../../shared/dto/customer.dto';
import { AddressDto } from '../../shared/dto/address.dto';

export class MergeSalesOrdersDto {
  @ApiProperty({ 
    description: 'Source order IDs to merge',
    type: [String],
    minItems: 2
  })
  @IsArray()
  @ArrayMinSize(2)
  @IsUUID('4', { each: true })
  sourceOrderIds: string[];

  @ApiProperty({ description: 'Channel order ID', required: false })
  @IsString()
  @IsOptional()
  channelOrderId?: string;

  @ApiProperty({ description: 'Sales channel', required: false })
  @IsString()
  @IsOptional()
  salesChannel?: string;

  @ApiProperty({ 
    description: 'Customer information',
    type: CustomerDto,
    required: false
  })
  @ValidateNested()
  @Type(() => CustomerDto)
  @IsOptional()
  customer?: CustomerDto;

  @ApiProperty({ 
    description: 'Shipping address',
    type: AddressDto,
    required: false
  })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  shippingAddress?: AddressDto;

  @ApiProperty({ description: 'Shipping address hash', required: false })
  @IsString()
  @IsOptional()
  shippingAddressHash?: string;

  @ApiProperty({ description: 'Total amount', required: false })
  @IsNumber()
  @IsOptional()
  totalAmount?: number;

  @ApiProperty({ description: 'Shipping fee', required: false })
  @IsNumber()
  @IsOptional()
  shippingFee?: number;

  @ApiProperty({ description: 'Warehouse ID', required: false })
  @IsUUID()
  @IsOptional()
  warehouseId?: string;
}

