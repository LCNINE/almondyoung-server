import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfigureLegDto {
  @ApiProperty({
    description: 'Payment provider type',
    maxLength: 64,
    example: 'POINTS',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  providerType!: string;

  @ApiProperty({
    description: 'Leg amount (minor units)',
    minimum: 1,
    example: 5000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({
    description: 'Execution order (ascending)',
    minimum: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequenceNo!: number;

  @ApiPropertyOptional({
    description: 'Whether the leg is mandatory',
    example: true,
    default: true,
  })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @ApiPropertyOptional({
    description: 'Leg metadata',
    type: 'object',
    additionalProperties: true,
    example: { channel: 'web' },
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class ConfigureLegsDto {
  @ApiProperty({
    description: 'Leg configuration list',
    type: () => [ConfigureLegDto],
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfigureLegDto)
  legs!: ConfigureLegDto[];
}
