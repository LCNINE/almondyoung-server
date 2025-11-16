import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsEnum, IsOptional, Min } from 'class-validator';

export class CalculatePriceRequestDto {
  @ApiProperty({ description: 'Variant ID' })
  @IsString()
  variantId: string;

  @ApiProperty({ 
    description: 'Quantity', 
    required: false,
    minimum: 1 
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiProperty({ 
    description: 'Customer type', 
    enum: ['regular', 'membership'],
    required: false,
    default: 'regular'
  })
  @IsOptional()
  @IsEnum(['regular', 'membership'])
  customerType?: 'regular' | 'membership';
}

