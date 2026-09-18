import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateSmsDeviceDto {
  @ApiProperty({ description: 'SMS Gate 앱의 device ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  deviceId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name: string;

  @ApiProperty({ minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  dailyLimit: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
