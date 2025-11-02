import { ApiProperty } from '@nestjs/swagger';

export class SkuPricingResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    skuId: string;

    @ApiProperty({ required: false })
    retailPrice?: number;

    @ApiProperty({ required: false })
    specialSalePrice?: number;

    @ApiProperty({ required: false })
    wholesalePrice?: number;

    @ApiProperty({ required: false })
    sellingPrice?: number;

    @ApiProperty({ required: false })
    priceEffectiveDate?: Date;

    @ApiProperty({ required: false })
    priceExpiryDate?: Date;

    @ApiProperty()
    createdAt: Date;

    @ApiProperty()
    updatedAt: Date;
}

