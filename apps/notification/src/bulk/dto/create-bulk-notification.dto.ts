import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  IsEnum,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Channel,
  NotificationCategory,
  NotificationPriority,
} from '../../shared/enums';

class AudienceDto {
  @ApiProperty({
    enum: ['ALL_USERS', 'SELECTED_USERS', 'FILTERED_USERS'],
    description: '대상 사용자 유형',
    example: 'ALL_USERS',
  })
  @IsEnum(['ALL_USERS', 'SELECTED_USERS', 'FILTERED_USERS'])
  kind: 'ALL_USERS' | 'SELECTED_USERS' | 'FILTERED_USERS';

  @ApiPropertyOptional({
    type: [String],
    description: '선택된 사용자 ID 목록 (SELECTED_USERS일 때 사용)',
    example: ['user1', 'user2', 'user3'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];

  @ApiPropertyOptional({
    type: 'object',
    description: '필터링 기준 (FILTERED_USERS일 때 사용)',
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
}
