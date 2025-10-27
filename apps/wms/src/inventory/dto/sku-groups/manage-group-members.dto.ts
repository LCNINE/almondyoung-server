import { IsUUID, IsNotEmpty, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddSkuToGroupDto {
    @ApiProperty({
        description: 'SKU ID to add to group',
        example: '550e8400-e29b-41d4-a716-446655440000',
        required: true
    })
    @IsUUID()
    @IsNotEmpty()
    skuId: string;
}

export class BulkAddSkusToGroupDto {
    @ApiProperty({
        description: 'Array of SKU IDs to add to group',
        type: [String],
        example: [
            '550e8400-e29b-41d4-a716-446655440000',
            '550e8400-e29b-41d4-a716-446655440001',
            '550e8400-e29b-41d4-a716-446655440002'
        ],
        required: true
    })
    @IsArray()
    @IsUUID(undefined, { each: true })
    @IsNotEmpty()
    skuIds: string[];
}

