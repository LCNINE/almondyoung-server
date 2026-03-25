// apps/notification/src/provider/dto/update-provider.dto.ts
import { IsObject, IsOptional, IsBoolean, IsNumber, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProviderStatus } from '../enums/provider-status.enum';

export class UpdateProviderDto {
  @ApiPropertyOptional({
    type: 'object',
    description: '프로바이더 설정',
    example: {
      apiKey: 'new-api-key',
      fromEmail: 'new@example.com',
    },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  config?: Record<string, any>;

  @ApiPropertyOptional({
    enum: ProviderStatus,
    description: '프로바이더 상태',
    example: 'ACTIVE', // 실제 enum 값 문자열로 안전하게 예시 지정
  })
  @IsEnum(ProviderStatus)
  @IsOptional()
  status?: ProviderStatus;

  @ApiPropertyOptional({
    description: '활성화 상태',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: '우선순위',
    example: 1,
  })
  @IsNumber()
  @IsOptional()
  priority?: number;

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
      period: string;
    };
  };

  @ApiPropertyOptional({
    type: 'object',
    description: '추가 메타데이터',
    example: { version: '1.1', updatedBy: 'admin' },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
