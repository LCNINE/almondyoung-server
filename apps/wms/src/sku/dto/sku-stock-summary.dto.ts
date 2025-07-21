import { ApiProperty } from '@nestjs/swagger';

export class SkuStockSummaryDto {
    @ApiProperty()
    skuId: string;

    @ApiProperty()
    skuName: string;

    @ApiProperty()
    skuCode: string;

    @ApiProperty()
    totalRealQuantity: number;

    @ApiProperty()
    totalReservedQuantity: number;

    @ApiProperty()
    totalAvailableQuantity: number;

    @ApiProperty({ description: '창고별 재고 현황' })
    warehouseStocks: Array<{
        warehouseId: string;
        warehouseName: string;
        realQuantity: number;
        reservedQuantity: number;
        availableQuantity: number;
    }>;
}
