import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsNumber, IsOptional, IsString, IsEnum } from 'class-validator';

export class CreateStockEntryBySkuIdDto {
    @ApiProperty({ description: 'SKU ID' })
    @IsUUID()
    @IsNotEmpty()
    skuId: string;

    @ApiProperty({ description: 'Product Matching의 Variant ID (참조용)', required: false })
    @IsUUID()
    @IsOptional()
    variantId?: string;

    @ApiProperty({ description: '창고 ID' })
    @IsUUID()
    @IsNotEmpty()
    warehouseId: string;

    @ApiProperty({ description: '로케이션 ID (선택사항)', required: false })
    @IsUUID()
    @IsOptional()
    locationId?: string;

    @ApiProperty({ description: '실재고 수량' })
    @IsNumber()
    @IsNotEmpty()
    quantity: number;

    @ApiProperty({ description: '재고 타입', enum: ['physical', 'infinite', 'drop_shipped', 'consignment'], required: false })
    @IsEnum(['physical', 'infinite', 'drop_shipped', 'consignment'])
    @IsOptional()
    stockType?: string;

    @ApiProperty({ description: '사유 (선택사항)', required: false })
    @IsString()
    @IsOptional()
    reason?: string;

    @ApiProperty({ description: '서브 바코드 (선택사항)', required: false })
    @IsString()
    @IsOptional()
    subBarcode?: string;

    @ApiProperty({ description: '포장 단위 (선택사항)', required: false })
    @IsString()
    @IsOptional()
    packingUnit?: string;
}