// apps/wms/src/movement/dto/inter-warehouse-transfer.dto.ts
import { IsUUID, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InterWarehouseTransferDto {
    @ApiProperty({ description: '출발 창고 ID' })
    @IsUUID()
    @IsNotEmpty()
    fromWarehouseId: string;

    @ApiProperty({ description: '도착 창고 ID' })
    @IsUUID()
    @IsNotEmpty()
    toWarehouseId: string;

    @ApiProperty({ description: 'SKU ID' })
    @IsUUID()
    @IsNotEmpty()
    skuId: string;

    @ApiProperty({ description: '이동 수량', minimum: 1 })
    @IsNumber()
    @Min(1)
    quantity: number;

    @ApiProperty({ description: '이동 사유' })
    @IsString()
    @IsNotEmpty()
    reason: string;
}