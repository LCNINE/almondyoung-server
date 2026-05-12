import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, ValidateNested, IsDateString, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { CustomerDto } from './customer.dto';
import { AddressDto } from './address.dto';

export class UpdateSalesOrderDto {
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

  @ApiProperty({ description: '총 주문 금액', required: false })
  @IsNumber()
  @IsOptional()
  totalAmount?: number;

  @ApiProperty({ description: '배송비', required: false })
  @IsNumber()
  @IsOptional()
  shippingFee?: number;

  @ApiProperty({ description: '처리 일시', required: false, type: String, format: 'date-time' })
  @IsDateString()
  @IsOptional()
  processedAt?: string;

  @ApiProperty({ description: '메모', required: false })
  @IsString()
  @IsOptional()
  memo?: string;
}
