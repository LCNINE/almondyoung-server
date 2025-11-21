import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsBoolean, IsUrl, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateSalesChannelDto {
  @ApiProperty({ 
    description: '채널 유형',
    enum: ['ONLINE', 'OFFLINE', 'MARKETPLACE', 'MOBILE_APP', 'SOCIAL_COMMERCE'],
    default: 'ONLINE',
    required: false
  })
  @IsOptional()
  @IsEnum(['ONLINE', 'OFFLINE', 'MARKETPLACE', 'MOBILE_APP', 'SOCIAL_COMMERCE'])
  type?: 'ONLINE' | 'OFFLINE' | 'MARKETPLACE' | 'MOBILE_APP' | 'SOCIAL_COMMERCE';

  @ApiProperty({
    description: '판매처 사이트 (필수)',
    enum: ['medusa', 'naver', 'coupang', 'phone_order', 'other']
  })
  @IsEnum(['medusa', 'naver', 'coupang', 'phone_order', 'other'])
  site: string;

  @ApiProperty({ description: '판매처 분류 ID', required: false })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ 
    description: '판매 채널 이름',
    minLength: 1,
    maxLength: 255
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({ description: '채널 설명', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '채널별 설정 정보', required: false })
  @IsOptional()
  config?: Record<string, any>;

  @ApiProperty({ description: '활성 상태', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: 'API 엔드포인트 URL', required: false })
  @IsOptional()
  @IsUrl()
  apiEndpoint?: string;

  @ApiProperty({ description: '인증 정보', required: false })
  @IsOptional()
  credentials?: Record<string, any>;
}

