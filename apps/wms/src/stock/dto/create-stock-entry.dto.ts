import { IsUUID, IsNotEmpty, IsNumber, IsOptional, IsDateString, IsEnum, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { barcodeTypeEnum, stockTypeEnum } from '../../../database/schemas/wms-schema';

export class CreateStockEntryDto {
    @ApiProperty({ description: 'SKU ID' })
    @IsUUID()
    @IsNotEmpty()
    skuId: string;

    @ApiProperty({ description: '창고 ID' })
    @IsUUID()
    @IsNotEmpty()
    warehouseId: string;

    @ApiProperty({ description: '위치 ID' })
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

    @ApiProperty({ description: '유통기한 (YYYY-MM-DD)', example: '2025-12-31', required: false })
    @IsDateString()
    @IsOptional()
    expiryDate?: string;

    @ApiProperty({ description: '제조일자 (YYYY-MM-DD)', example: '2024-01-01', required: false })
    @IsDateString()
    @IsOptional()
    manufacturedAt?: string;

    @ApiProperty({ description: '바코드 타입', enum: barcodeTypeEnum.enumValues, example: 'standard', required: false })
    @IsEnum(barcodeTypeEnum.enumValues)
    @IsOptional()
    barcodeType?: typeof barcodeTypeEnum.enumValues[number];

    @ApiProperty({ description: '서브 바코드 (LOT 번호 등)', example: 'LOT12345', required: false })
    @IsString()
    @IsOptional()
    subBarcode?: string;

    @ApiProperty({ description: '포장 단위', example: 'BOX', required: false })
    @IsString()
    @IsOptional()
    packingUnit?: string;

    @ApiProperty({ description: '재고 입고 사유 (예: purchase_order, manual_in)', example: 'purchase_order', required: false })
    @IsString()
    @IsOptional()
    reason?: string;

    @ApiProperty({ description: '관련 주문 ID (반품 시 등)', example: 'order-id-123', required: false })
    @IsUUID()
    @IsOptional()
    orderId?: string;
}
