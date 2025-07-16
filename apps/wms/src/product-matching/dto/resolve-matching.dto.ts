// apps/wms/src/product-matching/dto/resolve-matching.dto.ts
import { IsUUID, IsOptional, IsBoolean, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveMatchingDto {
    @ApiProperty({
        description: '매칭될 SKU ID 목록 (matched 상태일 경우 최소 하나 이상의 UUID 필수)',
        type: [String],
    })
    @IsArray()
    @IsUUID('all', { each: true })
    @IsOptional()
    skuIds?: string[];

    @ApiProperty({ description: '매칭을 무시할지 여부 (true인 경우 ignored 상태로 전환)' })
    @IsBoolean()
    @IsOptional()
    ignore?: boolean; // ignored 상태로 변경 시 true
}