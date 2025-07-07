import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsUUID, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSkuDto {

    @ApiProperty({
        description: 'SKU ID',
    })
    @IsUUID()
    @IsNotEmpty()
    id: string;

    @ApiProperty({
        description: 'SKU 코드',
    })
    @IsString()
    @IsNotEmpty()
    code: string;

    @ApiProperty({
        description: 'SKU 이름',
    })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({
        description: '기본 바코드',
    })
    @IsString()
    @IsOptional()
    defaultBarcode: string;


    @ApiProperty({ description: '배송 프로필 ID' })
    @IsUUID()
    @IsOptional()
    deliveryProfileId?: string;

    @ApiProperty({ description: '재고 관리 여부' })
    @IsBoolean()
    inventoryManagement: boolean;

    @ApiProperty({ description: '최근 1개월 판매량' })
    @IsNumber()
    @IsOptional()
    sale1m?: number;

    @ApiProperty({ description: '최근 3개월 판매량' })
    @IsNumber()
    @IsOptional()
    sale3m?: number;

}
