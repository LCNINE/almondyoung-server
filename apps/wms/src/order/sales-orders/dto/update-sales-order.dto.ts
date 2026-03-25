import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, ValidateNested, IsDateString, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { CustomerDto } from '../../shared/dto/customer.dto';
import { AddressDto } from '../../shared/dto/address.dto';

export class UpdateSalesOrderDto {
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
    required: false,
  })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  shippingAddress?: AddressDto;

  @ApiProperty({ description: 'Total amount', required: false })
  @IsNumber()
  @IsOptional()
  totalAmount?: number;

  @ApiProperty({ description: 'Shipping fee', required: false })
  @IsNumber()
  @IsOptional()
  shippingFee?: number;

  @ApiProperty({
    description: 'Processed at',
    required: false,
    type: String,
    format: 'date-time',
  })
  @IsDateString()
  @IsOptional()
  processedAt?: string;

  @ApiProperty({
    description: 'Memo',
    required: false,
    example: '기타 메모 내용',
  })
  @IsString()
  @IsOptional()
  memo?: string;
}
