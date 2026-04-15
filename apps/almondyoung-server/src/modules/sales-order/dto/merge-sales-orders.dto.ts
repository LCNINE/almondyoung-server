import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsString, IsArray, IsNumber, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { CustomerDto } from './customer.dto';
import { AddressDto } from './address.dto';

export class MergeSalesOrdersDto {
  @ApiProperty({ description: '병합할 주문 ID 목록', type: [String], minItems: 2 })
  @IsArray()
  @ArrayMinSize(2)
  @IsUUID('4', { each: true })
  sourceOrderIds: string[];

  @ApiProperty({ description: '채널 주문 ID', required: false })
  @IsString()
  @IsOptional()
  channelOrderId?: string;

  @ApiProperty({ description: '판매 채널', required: false })
  @IsString()
  @IsOptional()
  salesChannel?: string;

  @ApiProperty({ description: '고객 정보', type: CustomerDto, required: false })
  @ValidateNested()
  @Type(() => CustomerDto)
  @IsOptional()
  customer?: CustomerDto;

  @ApiProperty({ description: '배송지', type: AddressDto, required: false })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  shippingAddress?: AddressDto;

  @ApiProperty({ description: '배송지 해시', required: false })
  @IsString()
  @IsOptional()
  shippingAddressHash?: string;

  @ApiProperty({ description: '총 주문 금액', required: false })
  @IsNumber()
  @IsOptional()
  totalAmount?: number;

  @ApiProperty({ description: '배송비', required: false })
  @IsNumber()
  @IsOptional()
  shippingFee?: number;

  @ApiProperty({ description: '창고 ID', required: false })
  @IsUUID()
  @IsOptional()
  warehouseId?: string;
}
