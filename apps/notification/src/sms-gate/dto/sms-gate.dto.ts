import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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

export class UpdateSmsDeviceDto extends PartialType(PickType(CreateSmsDeviceDto, ['name', 'dailyLimit', 'enabled'] as const)) {}

export class SendSmsGateMessageDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  userIds: string[];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({ description: '비우면 한도가 남은 폰을 자동으로 고른다' })
  @IsOptional()
  @IsString()
  deviceId?: string;
}
