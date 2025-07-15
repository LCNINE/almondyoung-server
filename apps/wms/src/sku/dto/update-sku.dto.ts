import { PartialType } from '@nestjs/mapped-types';
import { CreateSkuDto } from './create-sku.dto';
import { IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSkuDto extends PartialType(CreateSkuDto) {
    @ApiProperty({ description: '재고 0이어도 항상 판매 가능한 상품 여부', required: false })
    @IsBoolean()
    @IsOptional()
    alwaysSellableZeroStock?: boolean;
}
