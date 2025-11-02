import { ApiProperty } from '@nestjs/swagger';

export class SkuManagersResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    skuId: string;

    @ApiProperty({ required: false })
    designerId?: string;

    @ApiProperty({ required: false })
    purchaseManagerId?: string;

    @ApiProperty({ required: false })
    registrationManagerId?: string;

    @ApiProperty()
    createdAt: Date;

    @ApiProperty()
    updatedAt: Date;
}

