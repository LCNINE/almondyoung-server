// apps/wms/src/stock/dto/intra-warehouse-move.dto.ts
import { IsUUID, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class IntraWarehouseMoveDto {
    @ApiProperty({ description: '이동할 재고 ID' })
    @IsUUID()
    @IsNotEmpty()
    stockId: string;

    @ApiProperty({ description: '새 위치 ID' })
    @IsUUID()
    @IsNotEmpty()
    newLocationId: string;

    @ApiProperty({ description: '이동 사유' })
    @IsString()
    @IsNotEmpty()
    reason: string;
}
