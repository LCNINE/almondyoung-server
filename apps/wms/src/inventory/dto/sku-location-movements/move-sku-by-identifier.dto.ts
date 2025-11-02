import { IsString, IsNotEmpty, IsUUID, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MoveSkuByIdentifierDto {
    @ApiProperty({
        description: 'SKU ID or Barcode for identification',
        example: '550e8400-e29b-41d4-a716-446655440000 or BC-12345'
    })
    @IsString()
    @IsNotEmpty()
    skuIdentifier: string; // UUID or Barcode

    @ApiProperty({ 
        description: 'From location ID (source location)',
        example: '550e8400-e29b-41d4-a716-446655440001'
    })
    @IsUUID()
    @IsNotEmpty()
    fromLocationId: string;

    @ApiProperty({ 
        description: 'To location ID (destination location)',
        example: '550e8400-e29b-41d4-a716-446655440002'
    })
    @IsUUID()
    @IsNotEmpty()
    toLocationId: string;

    @ApiProperty({ 
        description: 'Quantity to move (optional, if not provided, moves entire SKU)',
        required: false,
        minimum: 1,
        example: 10
    })
    @IsInt()
    @Min(1)
    @IsOptional()
    quantity?: number;

    @ApiProperty({ 
        description: 'Reason for movement',
        required: false,
        example: 'Reorganization'
    })
    @IsString()
    @IsOptional()
    reason?: string;

    @ApiProperty({ 
        description: 'User ID who performed the movement',
        required: false
    })
    @IsString()
    @IsOptional()
    movedBy?: string;
}

export class BulkMoveByIdentifierDto {
    @ApiProperty({
        description: 'Array of SKU movements identified by SKU identifier (UUID or barcode)',
        type: [MoveSkuByIdentifierDto],
    })
    @IsNotEmpty()
    movements: MoveSkuByIdentifierDto[];
}

