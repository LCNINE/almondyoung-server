import { IsString, IsEnum, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterFcmTokenDto {
  @ApiProperty({ description: 'FCM 등록 토큰' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ enum: ['ios', 'android', 'web'], description: '디바이스 플랫폼' })
  @IsEnum(['ios', 'android', 'web'])
  platform: 'ios' | 'android' | 'web';

  @ApiPropertyOptional({ description: '디바이스 고유 ID (같은 디바이스에서 토큰 갱신 시 사용)' })
  @IsString()
  @IsOptional()
  deviceId?: string;

  @ApiPropertyOptional({ description: '디바이스 모델명' })
  @IsString()
  @IsOptional()
  deviceModel?: string;

  @ApiPropertyOptional({ description: '디바이스 이름' })
  @IsString()
  @IsOptional()
  deviceName?: string;
}

export class DeactivateFcmTokenDto {
  @ApiProperty({ description: '비활성화할 FCM 토큰' })
  @IsString()
  @IsNotEmpty()
  token: string;
}
