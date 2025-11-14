import { ApiProperty } from '@nestjs/swagger';

export class SalesChannelDto {
  @ApiProperty({ description: '판매 채널 ID (UUID 형식)' })
  id: string;

  @ApiProperty({ 
    description: '판매 채널 타입',
    enum: ['ONLINE', 'OFFLINE', 'MARKETPLACE', 'MOBILE_APP', 'SOCIAL_COMMERCE']
  })
  type: 'ONLINE' | 'OFFLINE' | 'MARKETPLACE' | 'MOBILE_APP' | 'SOCIAL_COMMERCE';

  @ApiProperty({ description: '판매 채널 이름' })
  name: string;

  @ApiProperty({ description: '채널 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '채널별 설정 정보' })
  config: Record<string, any>;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: 'API 엔드포인트 URL', nullable: true })
  apiEndpoint: string | null;

  @ApiProperty({ description: '인증 정보' })
  credentials: Record<string, any>;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class ChannelListResponseDto {
  @ApiProperty({ description: '판매 채널 목록', type: [SalesChannelDto] })
  data: SalesChannelDto[];

  @ApiProperty({ description: '전체 아이템 수', minimum: 0 })
  total: number;

  @ApiProperty({ description: '현재 페이지 번호', minimum: 1 })
  page: number;

  @ApiProperty({ description: '페이지당 아이템 수', minimum: 1 })
  limit: number;
}

export class ChannelValidationResponseDto {
  @ApiProperty({ description: '설정 유효성 여부' })
  isValid: boolean;

  @ApiProperty({ description: '검증 오류 목록', type: [String] })
  errors: string[];
}

