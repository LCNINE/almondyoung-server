import { IsOptional, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateAdjustmentsDto {
    @ApiProperty({
        description: 'Filter to specific line IDs (optional - generates for all variances if not provided)',
        required: false,
        type: [String]
    })
    @IsArray()
    @IsUUID('4', { each: true })
    @IsOptional()
    lineIds?: string[];
}


