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


    @ApiProperty({ required: false })
    sale1m?: number;

    @ApiProperty({ required: false })
    sale3m?: number;

    @ApiProperty({ description: '안전 재고 (Safety stock)', example: 10, default: 0 })
    safetyStock: number;

    @ApiProperty({ required: true })
    masterId: string;

    @ApiProperty({ required: false, type: Object })
    optionKey?: Record<string, string>;

    @ApiProperty({ required: false, type: Object })
    master?: {
        id: string;
        name: string;
        code: string;
        hasOptions: boolean;
    };

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