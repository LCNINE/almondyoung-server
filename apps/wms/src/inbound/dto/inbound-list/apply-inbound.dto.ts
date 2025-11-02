import { IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApplyInboundDto {
    @ApiProperty({ description: 'Notes for the application', required: false })
    @IsString()
    @IsOptional()
    notes?: string;

    @ApiProperty({ description: 'Expected date override (YYYY-MM-DD)', required: false })
    @IsDateString()
    @IsOptional()
    expectedDate?: string;
}



