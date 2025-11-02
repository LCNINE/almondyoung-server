import { IsNotEmpty, IsUUID, IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSkuPricingDto {
    @ApiProperty({ description: 'SKU ID' })
    @IsUUID()
    @IsNotEmpty()
    skuId: string;

    @ApiProperty({ description: '소매가', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    retailPrice?: number;

    @ApiProperty({ description: '특가', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    specialSalePrice?: number;

    @ApiProperty({ description: '도매가', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    wholesalePrice?: number;

    @ApiProperty({ description: '현재 판매가', required: false, minimum: 0 })
    @IsInt()
    @Min(0)
    @IsOptional()
    sellingPrice?: number;

    @ApiProperty({ description: '가격 유효 시작일', required: false })
    @IsOptional()
    priceEffectiveDate?: Date;

    @ApiProperty({ description: '가격 유효 종료일', required: false })
    @IsOptional()
    priceExpiryDate?: Date;
}

