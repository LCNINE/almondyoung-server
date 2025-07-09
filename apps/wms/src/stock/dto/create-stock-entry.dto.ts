import { IsUUID, IsNotEmpty, IsNumber, IsOptional, IsDateString, IsEnum, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { barcodeTypeEnum, stockTypeEnum } from '../../../database/schemas/wms-schema';

export class CreateStockEntryDto {
    @ApiProperty({ description: 'Product Matching의 Variant ID (이 ID를 기반으로 SKU 및 재고가 생성)' })
    @IsUUID()
    @IsNotEmpty()
    variantId: string;

    @ApiProperty({ description: '생성할 SKU 이름' })
    @IsString()
    @IsNotEmpty()
    skuName: string;

    @ApiProperty({ description: '창고 ID' })
    @IsUUID()
    @IsNotEmpty()
    warehouseId: string;

    @ApiProperty({ description: '위치 ID', required: false })
    @IsUUID()
    @IsOptional()
    locationId?: string;

    @ApiProperty({ description: '실재고 수량' })
    @IsNumber()
    @IsNotEmpty()
    quantity: number;

    @ApiProperty({ description: '재고 유형', enum: stockTypeEnum.enumValues })
    @IsEnum(stockTypeEnum.enumValues)
    stockType: typeof stockTypeEnum.enumValues[number];

    @ApiProperty({ description: '유통기한 (YYYY-MM-DD)', required: false })
    @IsDateString()
    @IsOptional()
    expiryDate?: string;

    @ApiProperty({ description: '제조일자 (YYYY-MM-DD)', required: false })
    @IsDateString()
    @IsOptional()
    manufacturedAt?: string;

    @ApiProperty({ description: '바코드 타입 (재고 묶음에 대한 정보)', enum: barcodeTypeEnum.enumValues, required: false })
    @IsEnum(barcodeTypeEnum.enumValues)
    @IsOptional()
    barcodeType?: typeof barcodeTypeEnum.enumValues[number];

    @ApiProperty({ description: '서브 바코드 (LOT 번호 등 재고 묶음에 대한 정보)', required: false })
    @IsString()
    @IsOptional()
    subBarcode?: string;

    @ApiProperty({ description: '포장 단위 (재고 묶음에 대한 정보)', required: false })
    @IsString()
    @IsOptional()
    packingUnit?: string;

    @ApiProperty({ description: '사유', required: false })
    @IsString()
    @IsOptional()
    reason?: string;

    @ApiProperty({ description: '관련 주문 ID (반품 시 등)', required: false })
    @IsUUID()
    @IsOptional()
    orderId?: string;
}