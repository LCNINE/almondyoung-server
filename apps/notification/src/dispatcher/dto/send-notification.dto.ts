// apps/notification/src/dispatcher/dto/send-notification.dto.ts
import { IsString, IsEnum, IsOptional, IsObject, IsDateString, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel, NotificationCategory, NotificationPriority } from '../../shared/enums';

export class SendNotificationDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user-123',
  })
  @IsString()
  userId: string;

  @ApiProperty({
    type: [String],
    enum: Channel,
    description: '발송 채널 목록',
    example: ['EMAIL', 'KAKAO'],
  })
  @IsArray()
  @IsEnum(Channel, { each: true })
  channels: Channel[];

  @ApiProperty({
    enum: NotificationCategory,
    description: '알림 카테고리',
    example: 'TRANSACTIONAL', // 실제 enum 값으로 변경
  })
  @IsEnum(NotificationCategory)
  category: NotificationCategory;

  @ApiPropertyOptional({
    description: '템플릿 키',
    example: 'order-confirmation-template',
  })
  @IsString()
  @IsOptional()
  templateKey?: string;

  @ApiPropertyOptional({
    description: '이벤트 키',
    example: 'order.created',
  })
  @IsString()
  @IsOptional()
  eventKey?: string;

  @ApiPropertyOptional({
    type: 'object',
    description: '채널별 콘텐츠',
    example: {
      EMAIL: {
        subject: '주문 확인',
        body: '주문이 성공적으로 접수되었습니다.',
        metadata: { orderId: '12345' },
      },
      KAKAO: {
        body: '주문이 성공적으로 접수되었습니다.',
        metadata: { orderId: '12345' },
      },
    },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  content?: Record<
    string,
    {
      subject?: string;
      body: string;
      metadata?: Record<string, any>;
    }
  >;

  @ApiPropertyOptional({
    type: 'object',
    description: '추가 페이로드 데이터',
    example: { orderId: '12345', amount: 50000, items: ['item1', 'item2'] },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  payload?: Record<string, any>;

  @ApiPropertyOptional({
    type: 'object',
    description: '템플릿 변수',
    example: {
      userName: '홍길동',
      orderNumber: 'ORD-12345',
      totalAmount: '50,000원',
    },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  variables?: Record<string, any>;

  @ApiPropertyOptional({
    description: '상관관계 ID (트래킹용)',
    example: 'corr-12345',
  })
  @IsString()
  @IsOptional()
  correlationId?: string;

  @ApiPropertyOptional({
    description: '예약 발송 시간 (ISO 날짜 문자열)',
    example: '2024-01-15T10:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  sendAt?: string;

  @ApiPropertyOptional({
    enum: NotificationPriority,
    description: '알림 우선순위',
    example: 'HIGH',
  })
  @IsEnum(NotificationPriority)
  @IsOptional()
  priority?: NotificationPriority;

  @ApiPropertyOptional({
    type: 'object',
    description: '추가 메타데이터',
    example: { source: 'order-service', version: '1.0' },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
