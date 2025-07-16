// apps/wms/src/stock/dto/get-stock-query.dto.ts
import { IsUUID, IsOptional, IsDateString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { stockTypeEnum } from '../../../database/schemas/wms-schema';

export class GetStockQueryDto {
    @ApiProperty({ description: 'SKU ID 필터' })
    @IsUUID()
    @IsOptional()
    skuId?: string;

    @ApiProperty({ description: '창고 ID 필터' })
    @IsUUID()
    @IsOptional()
    warehouseId?: string;

    @ApiProperty({ description: '로케이션 ID 필터' })
    @IsUUID()
    @IsOptional()
    locationId?: string;

    @ApiProperty({ description: '재고 유형 필터', enum: stockTypeEnum.enumValues })
    @IsEnum(stockTypeEnum.enumValues)
    @IsOptional()
    stockType?: typeof stockTypeEnum.enumValues[number];

    @ApiProperty({ description: '특정 시점의 재고 조회 (ISO 8601 형식)', example: '2025-07-01T10:00:00Z', required: false })
    @IsDateString()
    @IsOptional()
    asOfTimestamp?: string;
}