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
import { CustomerDto } from './customer.dto';
import { AddressDto } from './address.dto';

export class CreateSalesOrderLineDto {
  @ApiProperty({ description: 'Product variant ID' })
  @IsUUID()
  @IsNotEmpty()
  variantId: string;

  @ApiProperty({ description: 'Product matching ID', required: false })
  @IsUUID()
  @IsOptional()
  productMatchingId?: string;

  @ApiProperty({ description: '상품명', required: false })
  @IsString()
  @IsOptional()
  productName?: string;

  @ApiProperty({ description: '수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: '단가', required: false })
  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  @ApiProperty({ description: '총 가격', required: false })
  @IsNumber()
  @IsOptional()
  totalPrice?: number;
}

export class CreateSalesOrderDto {
  @ApiProperty({ description: '채널 주문 ID' })
  @IsString()
  @IsNotEmpty()
  channelOrderId: string;

  @ApiProperty({ description: '판매 채널' })
  @IsString()
  @IsNotEmpty()
  salesChannel: string;

  @ApiProperty({ description: '고객 정보', type: CustomerDto, required: false })
  @ValidateNested()
  @Type(() => CustomerDto)
  @IsOptional()
  customer?: CustomerDto;

  @ApiProperty({ description: '배송지', type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress: AddressDto;

  @ApiProperty({ description: '배송지 해시', required: false })
  @IsString()
  @IsOptional()
  shippingAddressHash?: string;

  @ApiProperty({ description: '총 주문 금액', required: false })
  @IsNumber()
  @IsOptional()
  totalAmount?: number;

  @ApiProperty({ description: '배송비', required: false, default: 0 })
  @IsNumber()
  @IsOptional()
  shippingFee?: number;

  @ApiProperty({ description: '합배송 그룹 ID', required: false })
  @IsString()
  @IsOptional()
  mergeGroupId?: string;

  @ApiProperty({ description: '주문 일시', required: false, type: String, format: 'date-time' })
  @IsDateString()
  @IsOptional()
  orderDate?: string;

  @ApiProperty({ description: '주문 라인 목록', type: [CreateSalesOrderLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderLineDto)
  lines: CreateSalesOrderLineDto[];

  @ApiProperty({ description: 'Wallet 결제 인텐트 ID. Medusa 채널 주문만 해당. 취소 시 자동 환불에 사용됨.', required: false })
  @IsString()
  @IsOptional()
  walletIntentId?: string;
}
