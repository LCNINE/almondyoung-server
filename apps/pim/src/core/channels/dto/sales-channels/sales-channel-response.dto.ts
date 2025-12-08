import { ApiProperty } from '@nestjs/swagger';
import { ChannelCategoryDto } from '../channel-categories';

export class SalesChannelDto {
  @ApiProperty({ description: '판매 채널 ID (UUID 형식)' })
  id: string;

  @ApiProperty({
    description: '채널 유형 (기본값: ONLINE)',
    enum: ['ONLINE', 'OFFLINE', 'MARKETPLACE', 'MOBILE_APP', 'SOCIAL_COMMERCE'],
    default: 'ONLINE'
  })
  type: string;

  @ApiProperty({
    description: '판매처 사이트',
    enum: ['medusa', 'naver', 'coupang', 'phone_order', 'other']
  })
  site: string;

  @ApiProperty({ description: '판매처 분류 ID', nullable: true })
  categoryId: string | null;

  @ApiProperty({
    description: '판매처 분류 정보',
    type: ChannelCategoryDto,
    nullable: true,
    required: false
  })
  category?: ChannelCategoryDto | null;

  @ApiProperty({ description: '판매 채널 이름' })
  name: string;

  @ApiProperty({ description: '채널 설명', nullable: true })
  description: string | null;

  @ApiProperty({
    description: '채널 설정 (sender 정보 포함)',
    example: {
      sender: {
        name: '아몬드영',
        phone: '010-1234-5678',
        zipcode: '12345',
        address: '서울시 강남구',
        detailAddress: '101호'
      }
    }
  })
  config: Record<string, any>;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: 'API 엔드포인트 URL', nullable: true })
  apiEndpoint: string | null;

  @ApiProperty({ description: '인증 정보' })
  credentials: Record<string, any>;

  @ApiProperty({ description: '생성일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601 형식)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;
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

