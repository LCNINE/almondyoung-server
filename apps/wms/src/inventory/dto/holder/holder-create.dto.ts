import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsBoolean, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateHolderDto {
    @ApiProperty({ 
        description: 'Holder name', 
        example: '엘씨나인',
        maxLength: 255
    })
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    name: string;

    @ApiProperty({ 
        description: 'Whether this is company-owned asset (자사: true) or 3PL (false)', 
        example: true 
    })
    @IsBoolean()
    @IsNotEmpty()
    isOurAsset: boolean;
}

