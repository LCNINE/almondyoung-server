// apps/notification/src/provider/dto/provider-config.dto.ts
import { IsString, IsObject, IsOptional, IsNumber, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Base configuration that all providers share
export class BaseProviderConfigDto {
  @ApiPropertyOptional({
    description: '샌드박스 모드 사용 여부',
    example: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  sandbox?: boolean = false;

  @ApiPropertyOptional({
    description: '타임아웃 시간 (밀리초)',
    example: 30000,
    default: 30000,
  })
  @IsNumber()
  @IsOptional()
  timeout?: number = 30000; // 30 seconds

  @ApiPropertyOptional({
    description: '재시도 횟수',
    example: 3,
    default: 3,
  })
  @IsNumber()
  @IsOptional()
  retryAttempts?: number = 3;

  @ApiPropertyOptional({
    type: 'object',
    description: '추가 HTTP 헤더',
    example: { 'User-Agent': 'AlmondYoung-Notification/1.0' },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  headers?: Record<string, string>;
}

// Email Provider Configuration
export class EmailProviderConfigDto extends BaseProviderConfigDto {
  @ApiProperty({
    description: 'API 키',
    example: 'SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  })
  @IsString()
  apiKey: string;

  @ApiProperty({
    description: '발신자 이메일',
    example: 'noreply@almondyoung.com',
  })
  @IsString()
  fromEmail: string;

  @ApiPropertyOptional({
    description: '발신자 이름',
    example: 'Almond Young',
  })
  @IsString()
  @IsOptional()
  fromName?: string;

  @ApiPropertyOptional({
    description: '답장 주소',
    example: 'support@almondyoung.com',
  })
  @IsString()
  @IsOptional()
  replyToEmail?: string;

  @ApiPropertyOptional({
    type: 'object',
    description: '기본 태그',
    example: { service: 'notification', environment: 'production' },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  defaultTags?: Record<string, string>;

  @ApiPropertyOptional({
    description: '오픈 추적 사용 여부',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  trackOpens?: boolean = true;

  @ApiPropertyOptional({
    description: '클릭 추적 사용 여부',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  trackClicks?: boolean = true;
}

// SMS Provider Configuration
export class SmsProviderConfigDto extends BaseProviderConfigDto {
  @ApiPropertyOptional({
    description: '계정 SID (Twilio용)',
    example: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  })
  @IsString()
  accountSid?: string; // For Twilio

  @ApiPropertyOptional({
    description: '인증 토큰 (Twilio용)',
    example: 'your-auth-token',
  })
  @IsString()
  authToken?: string; // For Twilio

  @ApiPropertyOptional({
    description: 'API 키 (기타 프로바이더용)',
    example: 'your-api-key',
  })
  @IsString()
  @IsOptional()
  apiKey?: string; // For other providers

  @ApiPropertyOptional({
    description: 'API 시크릿 (기타 프로바이더용)',
    example: 'your-api-secret',
  })
  @IsString()
  @IsOptional()
  apiSecret?: string; // For other providers

  @ApiProperty({
    description: '발신번호',
    example: '+1234567890',
  })
  @IsString()
  fromNumber: string;

  @ApiPropertyOptional({
    description: '메시징 서비스 SID (Twilio용)',
    example: 'MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  })
  @IsString()
  @IsOptional()
  messagingServiceSid?: string; // For Twilio

  @ApiPropertyOptional({
    description: '배송 보고서 활성화 여부',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  enableDeliveryReports?: boolean = true;
}

// Kakao Provider Configuration
export class KakaoProviderConfigDto extends BaseProviderConfigDto {
  @ApiProperty({
    description: 'API 키',
    example: 'your-kakao-api-key',
  })
  @IsString()
  apiKey: string;

  @ApiProperty({
    description: '발신자 키',
    example: 'your-sender-key',
  })
  @IsString()
  senderKey: string;

  @ApiProperty({
    description: '플러스 친구 ID',
    example: 'your-plus-friend-id',
  })
  @IsString()
  plusFriendId: string;

  @ApiPropertyOptional({
    description: '앱 키',
    example: 'your-app-key',
  })
  @IsString()
  @IsOptional()
  appKey?: string;

  @ApiPropertyOptional({
    description: '시크릿 키',
    example: 'your-secret-key',
  })
  @IsString()
  @IsOptional()
  secretKey?: string;

  @ApiPropertyOptional({
    description: '템플릿 코드 사용 여부',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  useTemplateCode?: boolean = true;
}

// Push Provider Configuration
export class PushProviderConfigDto extends BaseProviderConfigDto {
  @ApiPropertyOptional({
    type: 'object',
    description: 'Firebase 서비스 계정 정보 (FCM용)',
    example: {
      type: 'service_account',
      project_id: 'your-project-id',
      private_key_id: 'your-private-key-id',
      private_key: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
      client_email: 'firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com',
      client_id: 'your-client-id',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
    },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  firebaseServiceAccount?: any; // For FCM

  @ApiPropertyOptional({
    description: '서버 키 (레거시 FCM)',
    example: 'AAAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  })
  @IsString()
  @IsOptional()
  serverKey?: string; // Legacy FCM

  @ApiPropertyOptional({
    description: '발신자 ID',
    example: '123456789012',
  })
  @IsString()
  @IsOptional()
  senderId?: string;

  @ApiPropertyOptional({
    description: '프로젝트 ID',
    example: 'your-firebase-project-id',
  })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({
    type: 'object',
    description: 'APNS 설정 (iOS용)',
    example: {
      teamId: 'your-team-id',
      keyId: 'your-key-id',
      bundleId: 'com.almondyoung.app',
      production: true,
      privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
    },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  apns?: {
    teamId: string;
    keyId: string;
    bundleId: string;
    production: boolean;
    privateKey: string;
  };

  @ApiPropertyOptional({
    type: 'object',
    description: '기본 옵션',
    example: {
      priority: 'high',
      ttl: 3600,
      collapseKey: 'notification-key',
    },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  defaultOptions?: {
    priority?: 'high' | 'normal';
    ttl?: number;
    collapseKey?: string;
  };
}
