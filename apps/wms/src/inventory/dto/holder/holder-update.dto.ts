import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class UpdateHolderDto {
    @ApiPropertyOptional({ 
        description: 'Holder name', 
        example: '엘씨나인',
        maxLength: 255
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    name?: string;

    @ApiPropertyOptional({ 
        description: 'Whether this is company-owned asset (자사: true) or 3PL (false)', 
        example: true 
    })
    @IsOptional()
    @IsBoolean()
    isOurAsset?: boolean;
}

