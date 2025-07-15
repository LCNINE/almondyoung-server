import { IsUUID, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveMatchingDto {
    @ApiProperty({ description: '매칭될 SKU ID (matched 상태일 경우 필수)' })
    @IsUUID()
    @IsOptional()
    skuId?: string;

    @ApiProperty({ description: '매칭을 무시할지 여부 (true인 경우 ignored 상태로 전환)' })
    @IsBoolean()
    @IsOptional()
    ignore?: boolean; // ignored 상태로 변경 시 true
}