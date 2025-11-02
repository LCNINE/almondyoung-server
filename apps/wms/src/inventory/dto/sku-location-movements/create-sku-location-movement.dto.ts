import { IsNotEmpty, IsUUID, IsString, IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSkuLocationMovementDto {
    @ApiProperty({ description: 'SKU ID' })
    @IsUUID()
    @IsNotEmpty()
    skuId: string;

    @ApiProperty({ description: '바코드' })
    @IsString()
    @IsNotEmpty()
    barcode: string;

    @ApiProperty({ description: '출발 위치 ID' })
    @IsUUID()
    @IsNotEmpty()
    fromLocationId: string;

    @ApiProperty({ description: '도착 위치 ID' })
    @IsUUID()
    @IsNotEmpty()
    toLocationId: string;

    @ApiProperty({ description: '이동 수량 (전체 이동시 null)', required: false, minimum: 1 })
    @IsInt()
    @Min(1)
    @IsOptional()
    quantity?: number;

    @ApiProperty({ description: '이동 사유', required: false })
    @IsString()
    @IsOptional()
    reason?: string;

    @ApiProperty({ description: '이동한 사용자 ID', required: false })
    @IsUUID()
    @IsOptional()
    movedBy?: string;
}

