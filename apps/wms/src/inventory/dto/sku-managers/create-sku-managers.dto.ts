import { IsNotEmpty, IsUUID, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSkuManagersDto {
    @ApiProperty({ description: 'SKU ID' })
    @IsUUID()
    @IsNotEmpty()
    skuId: string;

    @ApiProperty({ description: '상품디자이너 ID', required: false })
    @IsUUID()
    @IsOptional()
    designerId?: string;

    @ApiProperty({ description: '발주담당자 ID', required: false })
    @IsUUID()
    @IsOptional()
    purchaseManagerId?: string;

    @ApiProperty({ description: '상품등록자 ID', required: false })
    @IsUUID()
    @IsOptional()
    registrationManagerId?: string;
}

