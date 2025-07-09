import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsUUID, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSkuDto {
    @ApiProperty({ description: 'SKU 이름' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ description: '배송 프로필 ID', required: false })
    @IsUUID()
    @IsOptional()
    deliveryProfileId?: string;

    @ApiProperty({ description: '재고 관리 여부 (true: 물리 재고, false: 디지털 등)' })
    @IsBoolean()
    inventoryManagement: boolean;

    @ApiProperty({ description: '최근 1개월 판매량', required: false })
    @IsNumber()
    @IsOptional()
    sale1m?: number;

    @ApiProperty({ description: '최근 3개월 판매량', required: false })
    @IsNumber()
    @IsOptional()
    sale3m?: number;
}