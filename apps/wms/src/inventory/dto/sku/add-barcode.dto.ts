import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddBarcodeDto {
    @ApiProperty({ description: '바코드 값' })
    @IsString()
    @IsNotEmpty()
    barcode: string;

    @ApiProperty({ description: '포장 단위', required: false })
    @IsString()
    @IsOptional()
    packingUnit?: string;
}