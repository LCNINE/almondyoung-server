import { IsInt, Min, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCountDto {
    @ApiProperty({ description: 'Counted quantity', minimum: 0 })
    @IsInt()
    @Min(0)
    countedQuantity: number;

    @ApiProperty({ description: 'Notes', required: false })
    @IsString()
    @IsOptional()
    notes?: string;
}


