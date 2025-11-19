// apps/notification/src/bulk/dto/create-bulk-notification.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  IsEnum,
  IsIn,
  IsBoolean,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Channel,
  NotificationCategory,
  NotificationPriority,
} from '../../shared/enums';

class UserInfoDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user-123',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    description: '이메일 주소',
    example: 'user@example.com',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    description: '전화번호',
    example: '010-1234-5678',
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({
    description: '마케팅 수신 동의 여부',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isMarketingEnabled?: boolean;
}

class AudienceDto {
  @ApiProperty({
    enum: ['ALL_USERS', 'SELECTED_USERS', 'FILTERED_USERS'],
    description: '대상 사용자 유형',
    example: 'SELECTED_USERS',
  })
  @IsIn(['ALL_USERS', 'SELECTED_USERS', 'FILTERED_USERS'])
  kind: 'ALL_USERS' | 'SELECTED_USERS' | 'FILTERED_USERS';

  @ApiPropertyOptional({
    type: [UserInfoDto],
    description: '프론트엔드에서 조인/필터링된 사용자 정보 목록 (SELECTED_USERS, FILTERED_USERS일 때 사용)',
    example: [
      {
        userId: 'user-123',
        email: 'user@example.com',
        phoneNumber: '010-1234-5678',
        isMarketingEnabled: true,
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserInfoDto)
  users?: UserInfoDto[];

  @ApiPropertyOptional({
    type: 'object',
    description: '필터링 기준 (FILTERED_USERS일 때 사용, 프론트에서 이미 적용됨)',
    example: { membershipType: 'premium', shopCategories: ['fashion'] },
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  criteria?: Record<string, any>;
}

class ContentDto {
  @ApiPropertyOptional({
    description: '알림 제목',
    example: '새로운 주문이 도착했습니다',
  })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({
    description: '알림 본문',
    example: '주문번호 #12345가 배송 준비 중입니다.',
  })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({
    type: 'object',
    description: '추가 메타데이터',
    example: { orderId: '12345', amount: 50000 },
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class CreateBulkNotificationDto {
  @ApiProperty({
    description: '알림 이름',
    example: '주문 배송 알림',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: '알림 설명',
    example: '주문 배송 상태 변경 시 발송되는 알림',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: NotificationCategory,
    description: '알림 카테고리',
    example: 'TRANSACTIONAL', // 실제 enum 값 중 하나로 변경
  })
  @IsEnum(NotificationCategory)
  category: NotificationCategory;

  @ApiProperty({
    type: [String],
    enum: Channel,
    description: '발송 채널 목록',
    example: ['EMAIL', 'KAKAO'],
  })
  @IsArray()
  @IsEnum(Channel, { each: true })
  channels: Channel[];

  @ApiPropertyOptional({
    description: '사전 정의된 템플릿 키',
    example: 'order-shipping-template',
  })
  @IsOptional()
  @IsString()
  templateKey?: string;

  @ApiProperty({
    type: 'object',
    description: '채널별 직접 콘텐츠',
    example: {
      EMAIL: {
        subject: '주문 배송 알림',
        body: '주문번호 #12345가 배송 준비 중입니다.',
        metadata: { orderId: '12345' },
      },
      KAKAO: {
        body: '주문번호 #12345가 배송 준비 중입니다.',
        metadata: { orderId: '12345' },
      },
    },
    additionalProperties: true,
  })
  @IsObject()
  @ValidateNested({ each: true })
  @Type(() => ContentDto)
  content: { [key in Channel]?: ContentDto };

  @ApiPropertyOptional({
    description: '예약 발송 시간 (ISO 날짜 문자열)',
    example: '2024-01-15T10:00:00Z',
  })
  @IsOptional()
  @IsString()
  sendAt?: string;

  @ApiProperty({
    type: AudienceDto,
    description: '대상 사용자 설정',
  })
  @ValidateNested()
  @Type(() => AudienceDto)
  audience: AudienceDto;

  @ApiProperty({
    enum: NotificationPriority,
    description: '알림 우선순위',
    example: 'HIGH',
  })
  @IsEnum(NotificationPriority)
  priority: NotificationPriority;

  @ApiProperty({
    description: '생성자 ID',
    example: 'admin-user-123',
  })
  @IsString()
  createdBy: string;

  @ApiPropertyOptional({
    type: 'object',
    description: '캠페인 단위 공통 메타데이터 (payload 등)',
    example: {
      payload: {
        campaignName: '주문 배송 알림',
        orderType: 'premium',
      },
      tags: ['marketing', 'order'],
    },
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
