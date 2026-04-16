import { IsUUID, IsNotEmpty, IsNumber, IsString, IsOptional, IsDateString, IsEnum, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInboundDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: '입고 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({
    description: '거래처 유형 (domestic: 국내, overseas: 해외)',
    enum: ['domestic', 'overseas'],
  })
  @IsEnum(['domestic', 'overseas'])
  supplierType: 'domestic' | 'overseas';

  @ApiProperty({ description: '특정 창고 ID (지정하지 않으면 거래처 유형에 따라 자동 선택)', required: false })
  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @ApiProperty({ description: '위치 ID', required: false })
  @IsUUID()
  @IsOptional()
  locationId?: string;

  @ApiProperty({ description: '유통기한', required: false })
  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @ApiProperty({ description: '제조일자', required: false })
  @IsDateString()
  @IsOptional()
  manufacturedAt?: string;

  @ApiProperty({ description: '입고 사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({ description: '구매 주문 ID', required: false })
  @IsUUID()
  @IsOptional()
  purchaseOrderId?: string;
}
