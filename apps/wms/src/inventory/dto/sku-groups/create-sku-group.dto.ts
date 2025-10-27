import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSkuGroupDto {
    @ApiProperty({
        description: '그룹명 (Group name)',
        example: 'Eyelash Extensions - J Curl Collection',
        required: true
    })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({
        description: '그룹 코드 (Group code) - Leave empty to auto-generate',
        example: 'LASH-J-001',
        required: false
    })
    @IsString()
    @IsOptional()
    code?: string;

    @ApiProperty({
        description: '설명 (Description)',
        required: false,
        example: 'All J-curl lash combinations (0.05mm-0.25mm, 8mm-15mm lengths)'
    })
    @IsString()
    @IsOptional()
    description?: string;

    @ApiProperty({
        description: 'Inventory Master ID (WMS-internal master for grouping consistency)',
        required: false,
        example: '550e8400-e29b-41d4-a716-446655440000'
    })
    @IsUUID()
    @IsOptional()
    inventoryMasterId?: string;
}

export class UpdateSkuGroupDto {
    @ApiProperty({
        description: '그룹명 (Group name)',
        required: false,
        example: 'Updated Group Name'
    })
    @IsString()
    @IsOptional()
    name?: string;

    @ApiProperty({
        description: '설명 (Description)',
        required: false,
        example: 'Updated description'
    })
    @IsString()
    @IsOptional()
    description?: string;
}

