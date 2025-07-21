// apps/wms/src/product-matching/dto/option-matching.dto.ts
import { IsUUID, IsString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class OptionMappingDto {
    @ApiProperty({ description: '옵션 이름 (예: CPU, RAM)' })
    @IsString()
    optionName: string;

    @ApiProperty({ description: '옵션 값 (예: i7, 16GB)' })
    @IsString()
    optionValue: string;

    @ApiProperty({ description: '매칭될 SKU ID' })
    @IsUUID()
    skuId: string;
}

export class ResolveOptionMatchingDto {
    @ApiProperty({
        description: '옵션별 SKU 매핑 목록',
        type: [OptionMappingDto]
    })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OptionMappingDto)
    optionMappings: OptionMappingDto[];
}