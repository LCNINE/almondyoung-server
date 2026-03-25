// apps/notification/src/provider/dto/provider-filter.dto.ts
import { IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Channel } from '../../shared/enums';
import { ProviderStatus } from '../enums/provider-status.enum';

export class ProviderFilterDto {
  @ApiPropertyOptional({
    enum: Channel,
    description: '채널 필터',
    example: Channel.EMAIL,
  })
  @IsEnum(Channel)
  @IsOptional()
  channel?: Channel;

  @ApiPropertyOptional({
    enum: ProviderStatus,
    description: '상태 필터',
    example: ProviderStatus.ACTIVE,
  })
  @IsEnum(ProviderStatus)
  @IsOptional()
  status?: ProviderStatus;

  @ApiPropertyOptional({
    description: '활성화 상태 필터',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  isActive?: boolean;

  @ApiPropertyOptional({
    description: '프로바이더 이름 필터',
    example: 'sendgrid',
  })
  @IsOptional()
  providerName?: string;
}
