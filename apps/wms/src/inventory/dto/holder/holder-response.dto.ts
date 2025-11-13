import { ApiProperty } from '@nestjs/swagger';

export class HolderDto {
    @ApiProperty({ description: 'Holder ID' })
    id: string;

    @ApiProperty({ description: 'Holder name', example: '엘씨나인' })
    name: string;

    @ApiProperty({ description: 'Whether this is company-owned asset (자사) or 3PL', example: true })
    isOurAsset: boolean;

    @ApiProperty({ description: 'Created timestamp' })
    createdAt: string;

    @ApiProperty({ description: 'Updated timestamp' })
    updatedAt: string;
}

export class HolderListResponseDto {
    @ApiProperty({ description: 'List of holders', type: [HolderDto] })
    data: HolderDto[];

    @ApiProperty({ description: 'Total count', minimum: 0 })
    total: number;

    @ApiProperty({ description: 'Current page number', minimum: 1 })
    page: number;

    @ApiProperty({ description: 'Items per page', minimum: 1, maximum: 100 })
    limit: number;
}

