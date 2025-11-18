// apps/notification/src/provider/dto/test-provider.dto.ts
import { IsString, IsObject, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel } from '../../shared/enums';

export class TestProviderDto {
  @ApiProperty({
    description: '테스트 수신자',
    example: 'test@example.com',
  })
  @IsString()
  to: string; // Test recipient

  @ApiPropertyOptional({
    description: '테스트 제목',
    example: '테스트 알림',
  })
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiProperty({
    description: '테스트 내용',
    example: '이것은 테스트 메시지입니다.',
  })
  @IsString()
  content: string;

  @ApiPropertyOptional({
    type: 'object',
    description: '추가 메타데이터',
    example: { testMode: true, timestamp: '2024-01-15T10:00:00Z' },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class TestProviderResponseDto {
  @ApiProperty({
    description: '프로바이더 ID',
    example: 'provider-123',
  })
  providerId: string;

  @ApiProperty({
    description: '프로바이더 이름',
    example: 'SendGrid',
  })
  providerName: string;

  @ApiProperty({
    enum: Channel,
    description: '채널',
    example: 'EMAIL', 
  })
  channel: Channel;

  @ApiProperty({
    description: '성공 여부',
    example: true,
  })
  success: boolean;

  @ApiPropertyOptional({
    description: '메시지 ID',
    example: 'msg-12345',
  })
  messageId?: string;

  @ApiPropertyOptional({
    description: '에러 메시지',
    example: 'Invalid API key',
  })
  error?: string;

  @ApiProperty({
    description: '응답 시간 (밀리초)',
    example: 250,
  })
  latencyMs: number;

  @ApiProperty({
    description: '테스트 시간',
    example: '2024-01-15T10:00:00Z',
  })
  timestamp: Date;

  @ApiPropertyOptional({
    type: 'object',
    description: '프로바이더 응답',
    example: { messageId: 'msg-12345', status: 'sent' },
    additionalProperties: true,
  })
  providerResponse?: any;
}
