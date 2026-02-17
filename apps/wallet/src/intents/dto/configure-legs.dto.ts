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

export class ConfigureLegDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  providerType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequenceNo!: number;

  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class ConfigureLegsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfigureLegDto)
  legs!: ConfigureLegDto[];
}
