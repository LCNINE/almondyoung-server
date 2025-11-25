import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class AddressDto {
  @ApiProperty({ description: 'Address line 1' })
  @IsString()
  @IsNotEmpty()
  line1: string;

  @ApiProperty({ description: 'Address line 2', required: false })
  @IsString()
  @IsOptional()
  line2?: string;

  @ApiProperty({ description: 'City' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ description: 'State/Province', required: false })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiProperty({ description: 'Postal code' })
  @IsString()
  @IsNotEmpty()
  postalCode: string;

  @ApiProperty({ description: 'Country' })
  @IsString()
  @IsNotEmpty()
  country: string;
}

