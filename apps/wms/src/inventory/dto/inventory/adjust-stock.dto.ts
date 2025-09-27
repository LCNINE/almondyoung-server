import { IsUUID, IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustStockDto {
    @ApiProperty({ description: 'SKU ID' })
    @IsUUID()
    @IsNotEmpty()
    skuId: string;

    @ApiProperty({ description: '창고 ID' })
    @IsUUID()
    @IsNotEmpty()
    warehouseId: string;

    @ApiProperty({ description: '위치 ID', required: false })
    @IsUUID()
    @IsOptional()
    locationId?: string;

    @ApiProperty({ description: '변경할 수량(양수=가산, 음수=감산)' })
    @IsNumber()
    @IsNotEmpty()
    delta: number;

    @ApiProperty({ description: '조정 사유' })
    @IsString()
    @IsNotEmpty()
    reason: string;
}