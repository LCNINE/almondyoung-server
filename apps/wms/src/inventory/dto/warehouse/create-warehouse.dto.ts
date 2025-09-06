import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { warehouseTypeEnum } from '../../../../database/schemas/wms-schema';

export class CreateWarehouseDto {
    @ApiProperty({ description: '창고 이름' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({
        description: '창고 타입',
        enum: warehouseTypeEnum.enumValues,
        default: 'domestic'
    })
    @IsEnum(warehouseTypeEnum.enumValues)
    @IsOptional()
    type?: typeof warehouseTypeEnum.enumValues[number];

    @ApiProperty({ description: '창고 위치', required: false })
    @IsString()
    @IsOptional()
    location?: string;
}
