import { IsOptional, IsUUID, IsString, IsEnum, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class InboundListFiltersDto {
    @ApiProperty({ description: 'Status filter', required: false, enum: ['pending', 'applied', 'receiving', 'confirmed'] })
    @IsEnum(['pending', 'applied', 'receiving', 'confirmed'])
    @IsOptional()
    status?: 'pending' | 'applied' | 'receiving' | 'confirmed';

    @ApiProperty({ description: 'Supplier ID filter', required: false })
    @IsUUID()
    @IsOptional()
    supplierId?: string;

    @ApiProperty({ description: 'Warehouse ID filter', required: false })
    @IsUUID()
    @IsOptional()
    warehouseId?: string;

    @ApiProperty({ description: 'Purchase Order ID filter', required: false })
    @IsUUID()
    @IsOptional()
    purchaseOrderId?: string;

    @ApiProperty({ description: 'Start date (YYYY-MM-DD)', required: false })
    @IsString()
    @IsOptional()
    startDate?: string;

    @ApiProperty({ description: 'End date (YYYY-MM-DD)', required: false })
    @IsString()
    @IsOptional()
    endDate?: string;

    @ApiProperty({ description: 'Barcode search (partial match)', required: false })
    @IsString()
    @IsOptional()
    barcodeSearch?: string;

    @ApiProperty({ description: 'SKU name/code search', required: false })
    @IsString()
    @IsOptional()
    skuSearch?: string;

    @ApiProperty({ description: 'Page limit', required: false, default: 50, minimum: 1, maximum: 100 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @IsOptional()
    limit?: number = 50;

    @ApiProperty({ description: 'Page offset', required: false, default: 0, minimum: 0 })
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @IsOptional()
    offset?: number = 0;
}



