import { ApiProperty } from '@nestjs/swagger';

// Nested DTOs for type safety and proper Swagger documentation
export class InboundListSupplierDto {
    @ApiProperty({ description: 'Supplier ID' })
    id: string;

    @ApiProperty({ description: 'Supplier name' })
    name: string;
}

export class InboundListPurchaseOrderDto {
    @ApiProperty({ description: 'Purchase Order ID' })
    id: string;

    @ApiProperty({ description: 'PO type', enum: ['domestic', 'foreign'] })
    type: string;

    @ApiProperty({ description: 'Expected arrival date', required: false, nullable: true })
    expectedArrival: string | null;

    @ApiProperty({ description: 'Supplier information', type: InboundListSupplierDto, required: false, nullable: true })
    supplier: InboundListSupplierDto | null;
}

export class InboundListSkuDto {
    @ApiProperty({ description: 'SKU ID' })
    id: string;

    @ApiProperty({ description: 'SKU name' })
    name: string;

    @ApiProperty({ description: 'SKU code' })
    code: string;

    @ApiProperty({ description: 'Default barcode', required: false, nullable: true })
    defaultBarcode: string | null;
}

export class InboundListItemDto {
    @ApiProperty({ description: 'Inbound list item ID' })
    id: string;

    @ApiProperty({ description: 'Purchase Order ID' })
    poId: string;

    @ApiProperty({ description: 'SKU ID' })
    skuId: string;

    @ApiProperty({ description: 'Quantity', minimum: 1 })
    quantity: number;

    @ApiProperty({ description: 'Barcode', required: false, nullable: true })
    barcode: string | null;

    @ApiProperty({ description: 'Status', enum: ['pending', 'applied', 'receiving', 'confirmed'] })
    status: string;

    @ApiProperty({ description: 'Created timestamp' })
    createdAt: Date;

    @ApiProperty({ description: 'Updated timestamp' })
    updatedAt: Date;

    @ApiProperty({ description: 'Purchase Order information', type: InboundListPurchaseOrderDto })
    purchaseOrder: InboundListPurchaseOrderDto;

    @ApiProperty({ description: 'SKU information', type: InboundListSkuDto })
    sku: InboundListSkuDto;
}

export class InboundListResponseDto {
    @ApiProperty({ description: 'List of inbound items', type: [InboundListItemDto] })
    items: InboundListItemDto[];

    @ApiProperty({ description: 'Total count of items', minimum: 0 })
    total: number;

    @ApiProperty({ description: 'Page limit', minimum: 1, maximum: 100 })
    limit: number;

    @ApiProperty({ description: 'Page offset', minimum: 0 })
    offset: number;
}



