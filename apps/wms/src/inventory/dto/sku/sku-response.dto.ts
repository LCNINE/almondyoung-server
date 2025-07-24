// apps/wms/src/inventory/dto/sku/sku-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class BarcodeDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    barcode: string;

    @ApiProperty()
    barcodeType: string;

    @ApiProperty({ required: false })
    packingUnit?: string;
}

export class SkuResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    name: string;

    @ApiProperty()
    code: string;

    @ApiProperty({ required: false })
    defaultBarcode?: string;

    @ApiProperty({ required: false })
    deliveryProfileId?: string;

    @ApiProperty()
    inventoryManagement: boolean;

    @ApiProperty()
    preStockSellable: boolean;

    @ApiProperty()
    alwaysSellableZeroStock: boolean;

    @ApiProperty({ required: false })
    sale1m?: number;

    @ApiProperty({ required: false })
    sale3m?: number;

    @ApiProperty({ type: [BarcodeDto] })
    barcodes: BarcodeDto[];

    @ApiProperty({ type: [String] })
    supplierNames: string[];

    @ApiProperty({ type: [String] })
    categoryNames: string[];

    @ApiProperty()
    createdAt: Date;

    @ApiProperty()
    updatedAt: Date;
}