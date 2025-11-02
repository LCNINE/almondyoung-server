import { IsNotEmpty, IsUUID, IsOptional, IsInt, Min, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImmediateReceiveDto {
    @ApiProperty({ description: 'Warehouse ID where items will be received' })
    @IsUUID()
    @IsNotEmpty()
    warehouseId: string;

    @ApiProperty({ description: 'Location ID (optional)', required: false })
    @IsUUID()
    @IsOptional()
    locationId?: string;

    @ApiProperty({ description: 'Actual quantity received (if different from expected)', required: false })
    @IsInt()
    @Min(1)
    @IsOptional()
    actualQuantity?: number;

    @ApiProperty({ description: 'Notes', required: false })
    @IsString()
    @IsOptional()
    notes?: string;
}



