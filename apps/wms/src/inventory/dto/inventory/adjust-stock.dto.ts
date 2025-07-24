import { IsUUID, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustStockDto {
    @ApiProperty({ description: '재고 엔트리 ID (stocks.id) - 어떤 특정 재고 묶음을 조정할 것인지' })
    @IsUUID()
    @IsNotEmpty()
    stockId: string;

    @ApiProperty({ description: '변경할 수량' })
    @IsNumber()
    @IsNotEmpty()
    delta: number;

    @ApiProperty({ description: '조정 사유' })
    @IsString()
    @IsNotEmpty()
    reason: string;
}