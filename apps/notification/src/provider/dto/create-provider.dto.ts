// apps/notification/src/provider/dto/create-provider.dto.ts
import {
    IsString,
    IsEnum,
    IsObject,
    IsOptional,
    IsBoolean,
    IsNumber,
  } from 'class-validator';
  import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
  import { Channel } from '../../shared/enums';
  
  export class CreateProviderDto {
    @ApiProperty({
      enum: Channel,
      description: '알림 채널',
      example: 'EMAIL', // 실제 enum 값으로 지정
    })
    @IsEnum(Channel)
    channel: Channel;
  
    @ApiProperty({
      description: '프로바이더 이름',
      example: 'sendgrid',
    })
    @IsString()
    providerName: string; // 'sendgrid', 'twilio', 'kakao', 'fcm'
  
    @ApiProperty({
      type: 'object',
      description: '프로바이더별 설정',
      example: {
        apiKey: 'your-api-key',
        fromEmail: 'noreply@example.com',
        fromName: 'Almond Young',
      },
      additionalProperties: true,
    })
    @IsObject()
    config: Record<string, any>; // Provider-specific configuration
  
    @ApiPropertyOptional({
      description: '활성화 상태',
      example: true,
      default: true,
    })
    @IsBoolean()
    @IsOptional()
    isActive?: boolean = true;
  
    @ApiPropertyOptional({
      description: '우선순위 (높을수록 우선)',
      example: 0,
      default: 0,
    })
    @IsNumber()
    @IsOptional()
    priority?: number = 0; // Higher priority = preferred provider
  
    @ApiPropertyOptional({
      type: 'object',
      description: '프로바이더 기능',
      example: {
        bulkSend: true,
        scheduling: true,
        tracking: true,
        templating: true,
        personalization: true,
        maxRecipientsPerRequest: 1000,
        rateLimit: {
          requests: 100,
          period: '1m',
        },
      },
      additionalProperties: true,
    })
    @IsObject()
    @IsOptional()
    capabilities?: {
      bulkSend?: boolean;
      scheduling?: boolean;
      tracking?: boolean;
      templating?: boolean;
      personalization?: boolean;
      maxRecipientsPerRequest?: number;
      rateLimit?: {
        requests: number;
        period: string; // '1m', '1h', '1d'
      };
    };
  
    @ApiPropertyOptional({
      type: 'object',
      description: '추가 메타데이터',
      example: { version: '1.0', region: 'us-east-1' },
      additionalProperties: true,
    })
    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;
  }
  