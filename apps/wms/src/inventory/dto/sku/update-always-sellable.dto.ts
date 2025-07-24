// apps/wms/src/inventory/dto/sku/update-always-sellable.dto.ts
import { IsBoolean, IsArray, ValidateNested, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateAlwaysSellableDto {
    @ApiProperty({ description: '재고 0이어도 항상 판매 가능 여부' })
    @IsBoolean()
    value: boolean;
}

export class BatchUpdateItem {
    @ApiProperty({ description: 'SKU ID' })
    @IsUUID()
    skuId: string;

    @ApiProperty({ description: '재고 0이어도 항상 판매 가능 여부' })
    @IsBoolean()
    value: boolean;
}

export class BatchUpdateAlwaysSellableDto {
    @ApiProperty({ description: '업데이트할 SKU 목록', type: [BatchUpdateItem] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => BatchUpdateItem)
    updates: BatchUpdateItem[];
}