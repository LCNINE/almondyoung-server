import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export class HolderQueryDto {
    @ApiPropertyOptional({ 
        description: 'Search term for holder name', 
        example: '엘씨나인' 
    })
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional({ 
        description: 'Filter by asset ownership - true: 자사(company-owned), false: 3PL', 
        example: true 
    })
    @IsOptional()
    @Transform(({ value }) => {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return value;
    })
    @IsBoolean()
    isOurAsset?: boolean;

    @ApiPropertyOptional({
        description: 'Page number (starts from 1)',
        example: 1,
        default: 1
    })
    @IsOptional()
    @Transform(({ value }) => parseInt(value) || 1)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({
        description: 'Items per page',
        example: 20,
        default: 20
    })
    @IsOptional()
    @Transform(({ value }) => parseInt(value) || 20)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;
}

