import { IsNumber, IsString, IsOptional, IsUUID, Min, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ProcessOutboundDto {
    @ApiProperty({ description: '출고 수량', minimum: 1 })
    @IsNumber()
    @Min(1)
    quantity: number;

    @ApiProperty({ description: '출고 사유' })
    @IsString()
    @IsNotEmpty()
    reason: string;

    @ApiProperty({ description: '주문 ID', required: false })
    @IsUUID()
    @IsOptional()
    orderId?: string;
}