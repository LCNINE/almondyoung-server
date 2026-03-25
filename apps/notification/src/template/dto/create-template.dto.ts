// apps/notification/src/template/dto/create-template.dto.ts
import { IsString, IsObject, IsOptional, IsEnum, IsArray, ValidateNested, IsBoolean, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationCategory } from '../../shared/enums';

// ===== FCM (Firebase Cloud Messaging) 관련 DTO =====
export class FCMNotificationConfig {
  @ApiPropertyOptional({ description: '알림 제목', example: '새로운 주문이 도착했습니다' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '알림 본문', example: '주문번호 #12345가 배송 준비 중입니다.' })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({ description: '알림 아이콘', example: 'ic_notification' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ description: '알림 색상', example: '#FF0000' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ description: '알림 사운드', example: 'default' })
  @IsOptional()
  @IsString()
  sound?: string;

  @ApiPropertyOptional({ description: '알림 태그', example: 'order-notification' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ description: 'Android 채널 ID', example: 'order_channel' })
  @IsOptional()
  @IsString()
  channelId?: string;

  @ApiPropertyOptional({ description: '우선순위 (1-10)', example: 5 })
  @IsOptional()
  @IsNumber()
  priority?: number;

  @ApiPropertyOptional({ description: '알림 이미지 URL', example: 'https://example.com/image.jpg' })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class FCMDataMessage {
  @ApiProperty({
    type: 'object',
    description: '커스텀 데이터',
    example: { orderId: '12345', type: 'order_update' },
    additionalProperties: true,
  })
  @IsObject()
  data: Record<string, string>;

  @ApiPropertyOptional({ description: '콜랩스 키', example: 'order-updates' })
  @IsOptional()
  @IsString()
  collapseKey?: string;

  @ApiPropertyOptional({ description: 'Time to live (초)', example: 3600 })
  @IsOptional()
  @IsNumber()
  ttl?: number;

  @ApiPropertyOptional({ description: 'FCM 토픽', example: 'order-updates' })
  @IsOptional()
  @IsString()
  topic?: string;
}

export class FCMConfig {
  @ApiPropertyOptional({ type: FCMNotificationConfig, description: 'FCM 알림 설정' })
  @IsOptional()
  @ValidateNested()
  @Type(() => FCMNotificationConfig)
  notification?: FCMNotificationConfig;

  @ApiPropertyOptional({ type: FCMDataMessage, description: 'FCM 데이터 메시지' })
  @IsOptional()
  @ValidateNested()
  @Type(() => FCMDataMessage)
  data?: FCMDataMessage;

  @ApiPropertyOptional({ description: '클릭 시 액션', example: 'OPEN_ORDER_DETAIL' })
  @IsOptional()
  @IsString()
  clickAction?: string;

  @ApiPropertyOptional({ description: '딥링크 URL', example: 'almondyoung://order/12345' })
  @IsOptional()
  @IsString()
  link?: string;
}

// ===== 이메일 관련 DTO =====
export class EmailAttachment {
  @ApiProperty({ description: '파일명', example: 'invoice.pdf' })
  @IsString()
  filename: string;

  @ApiProperty({ description: 'Base64 인코딩된 파일 내용', example: 'JVBERi0xLjQKJcfsj6IK...' })
  @IsString()
  content: string;

  @ApiProperty({ description: 'MIME 타입', example: 'application/pdf' })
  @IsString()
  contentType: string;

  @ApiPropertyOptional({ description: '인라인 이미지용 Content-ID', example: 'logo' })
  @IsOptional()
  @IsString()
  cid?: string;
}

export class EmailConfig {
  @ApiPropertyOptional({ description: 'HTML 템플릿', example: '<html>...</html>' })
  @IsOptional()
  @IsString()
  htmlTemplate?: string;

  @ApiPropertyOptional({ description: '텍스트 템플릿', example: '{{title}}\n\n{{content}}' })
  @IsOptional()
  @IsString()
  textTemplate?: string;

  @ApiPropertyOptional({ type: [EmailAttachment], description: '첨부파일 목록' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmailAttachment)
  attachments?: EmailAttachment[];

  @ApiPropertyOptional({ description: '답장 주소', example: 'support@almondyoung.com' })
  @IsOptional()
  @IsString()
  replyTo?: string;

  @ApiPropertyOptional({ description: '발신자 이름', example: 'Almond Young' })
  @IsOptional()
  @IsString()
  fromName?: string;

  @ApiPropertyOptional({ description: '발신자 이메일', example: 'noreply@almondyoung.com' })
  @IsOptional()
  @IsString()
  fromEmail?: string;

  @ApiPropertyOptional({ type: [String], description: '참조', example: ['manager@almondyoung.com'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cc?: string[];

  @ApiPropertyOptional({ type: [String], description: '숨은 참조', example: ['admin@almondyoung.com'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bcc?: string[];

  @ApiPropertyOptional({ enum: ['high', 'normal', 'low'], description: '우선순위', example: 'normal' })
  @IsOptional()
  @IsString()
  priority?: 'high' | 'normal' | 'low';
}

// ===== SMS 관련 DTO =====
export class SMSConfig {
  @ApiPropertyOptional({ description: '발신번호', example: '+1234567890' })
  @IsOptional()
  @IsString()
  fromNumber?: string;

  @ApiPropertyOptional({ description: 'MMS로 발송 여부', example: false })
  @IsOptional()
  @IsBoolean()
  sendAsMms?: boolean;

  @ApiPropertyOptional({ description: '유효기간', example: '24h' })
  @IsOptional()
  @IsString()
  validityPeriod?: string;

  @ApiPropertyOptional({ description: '최대 가격', example: '0.05' })
  @IsOptional()
  @IsString()
  maxPrice?: string;

  @ApiPropertyOptional({ description: '스마트 인코딩', example: true })
  @IsOptional()
  @IsBoolean()
  smartEncoded?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'MMS 미디어 URL들', example: ['https://example.com/image.jpg'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];
}

// ===== 카카오톡 관련 DTO =====
// (KakaoTemplateButton, KakaoTemplateItem, KakaoTemplateItemList, KakaoTemplateItemHighlight, KakaoTemplateRepresentLink 그대로 유지)

export class KakaoTemplateButton {
  @ApiProperty({ description: '버튼 순서', example: '1' })
  @IsString()
  ordering: string;

  @ApiProperty({
    enum: ['WL', 'AL', 'DS', 'BK', 'MD', 'BC', 'BT', 'AC', 'BF', 'P1', 'P2', 'P3'],
    description: '버튼 타입',
    example: 'WL',
  })
  @IsString()
  type: string;

  @ApiProperty({ description: '버튼 이름', example: '주문 확인하기' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '모바일 링크', example: 'https://m.almondyoung.com/order/12345' })
  @IsOptional()
  @IsString()
  linkMo?: string;

  @ApiPropertyOptional({ description: 'PC 링크', example: 'https://www.almondyoung.com/order/12345' })
  @IsOptional()
  @IsString()
  linkPc?: string;

  @ApiPropertyOptional({ description: 'iOS 스킴', example: 'almondyoung://order/12345' })
  @IsOptional()
  @IsString()
  schemeIos?: string;

  @ApiPropertyOptional({ description: 'Android 스킴', example: 'almondyoung://order/12345' })
  @IsOptional()
  @IsString()
  schemeAndroid?: string;

  @ApiPropertyOptional({ description: '비즈폼 ID', example: 12345 })
  @IsOptional()
  bizFormId?: number;

  @ApiPropertyOptional({ description: '플러그인 ID', example: 'plugin-123' })
  @IsOptional()
  @IsString()
  pluginId?: string;
}

// KakaoTemplateItem, KakaoTemplateItemList, KakaoTemplateItemHighlight, KakaoTemplateRepresentLink
// (작성하신 코드 그대로 사용 가능)

export class KakaoTemplateItem {
  @ApiProperty({ description: '아이템 제목', example: '주문번호' })
  @IsString()
  title: string;

  @ApiProperty({ description: '아이템 설명', example: 'ORD-12345' })
  @IsString()
  description: string;
}

export class KakaoTemplateItemList {
  @ApiProperty({ type: [KakaoTemplateItem], description: '아이템 목록' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KakaoTemplateItem)
  list: KakaoTemplateItem[];

  @ApiPropertyOptional({ type: KakaoTemplateItem, description: '요약 아이템' })
  @IsOptional()
  @ValidateNested()
  @Type(() => KakaoTemplateItem)
  summary?: KakaoTemplateItem;
}

export class KakaoTemplateItemHighlight {
  @ApiPropertyOptional({ description: '하이라이트 제목', example: '주문 완료' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '하이라이트 설명', example: '주문이 성공적으로 완료되었습니다.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '하이라이트 이미지 URL', example: 'https://example.com/highlight.jpg' })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class KakaoTemplateRepresentLink {
  @ApiPropertyOptional({ description: '모바일 대표 링크', example: 'https://m.almondyoung.com/order/12345' })
  @IsOptional()
  @IsString()
  linkMo?: string;

  @ApiPropertyOptional({ description: 'PC 대표 링크', example: 'https://www.almondyoung.com/order/12345' })
  @IsOptional()
  @IsString()
  linkPc?: string;

  @ApiPropertyOptional({ description: 'iOS 대표 스킴', example: 'almondyoung://order/12345' })
  @IsOptional()
  @IsString()
  schemeIos?: string;

  @ApiPropertyOptional({ description: 'Android 대표 스킴', example: 'almondyoung://order/12345' })
  @IsOptional()
  @IsString()
  schemeAndroid?: string;
}

export class KakaoTemplateConfig {
  @ApiProperty({ description: 'NHN 템플릿 코드', example: 'ORDER_CONFIRM' })
  @IsString()
  templateCode: string;

  @ApiProperty({ description: 'NHN 템플릿명', example: '주문 확인 알림' })
  @IsString()
  templateName: string;

  @ApiProperty({ description: '템플릿 본문', example: '안녕하세요 {{userName}}님...' })
  @IsString()
  templateContent: string;

  @ApiPropertyOptional({ description: 'NHN 내부 템플릿 ID (동기화 후 자동 설정)', example: 'TEMPLATE_12345' })
  @IsOptional()
  @IsString()
  providerTemplateId?: string;

  @ApiPropertyOptional({
    enum: ['PENDING', 'REQUESTED', 'APPROVED', 'REJECTED', 'INACTIVE'],
    description: 'NHN 템플릿 상태',
    example: 'PENDING',
  })
  @IsOptional()
  @IsString()
  status?: 'PENDING' | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'INACTIVE';

  @ApiPropertyOptional({ description: '마지막 동기화 시각', example: '2024-01-15T10:00:00Z' })
  @IsOptional()
  @IsString()
  lastSyncedAt?: string;

  @ApiPropertyOptional({ description: '동기화 에러 메시지', example: '템플릿 검수 반려: 부적절한 내용' })
  @IsOptional()
  @IsString()
  lastSyncError?: string;

  // (이하 옵션 필드들 그대로 유지)
}

export class CreateTemplateDto {
  @ApiProperty({ description: '템플릿 키', example: 'order-confirmation-template' })
  @IsString()
  templateKey: string;

  @ApiProperty({ description: '템플릿 이름', example: '주문 확인 템플릿' })
  @IsString()
  name: string;

  @ApiProperty({
    enum: NotificationCategory,
    description: '알림 카테고리',
    example: NotificationCategory.TRANSACTIONAL,
  })
  @IsEnum(NotificationCategory)
  category: NotificationCategory;

  @ApiProperty({
    type: 'object',
    description: '채널별 콘텐츠',
    example: {
      ko: {
        EMAIL: {
          subject: '주문 확인',
          body: '안녕하세요 {{userName}}님, 주문이 성공적으로 접수되었습니다.',
          metadata: { template: 'order-confirmation' },
        },
        KAKAO: {
          body: '안녕하세요 {{userName}}님, 주문이 성공적으로 접수되었습니다.',
          metadata: { template: 'order-confirmation' },
        },
      },
    },
    additionalProperties: true,
  })
  @IsObject()
  contents: Record<
    string,
    Record<
      string,
      {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
      }
    >
  >;

  @ApiProperty({
    type: 'object',
    description: '변수 스키마',
    example: {
      userName: { type: 'string', required: true, description: '사용자 이름' },
      orderNumber: { type: 'string', required: true, description: '주문번호' },
      totalAmount: { type: 'string', required: true, description: '총 금액' },
    },
    additionalProperties: true,
  })
  @IsObject()
  variablesSchema: Record<string, any>;

  @ApiPropertyOptional({
    type: 'object',
    description: '추가 메타데이터',
    example: { version: '1.0', author: 'admin' },
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiProperty({
    type: [String],
    description: '지원 채널 목록',
    example: ['EMAIL', 'KAKAO', 'SMS', 'PUSH'],
  })
  @IsArray()
  @IsString({ each: true })
  supportedChannels: string[];

  @ApiPropertyOptional({ type: FCMConfig, description: 'FCM 설정' })
  @IsOptional()
  @ValidateNested()
  @Type(() => FCMConfig)
  fcmConfig?: FCMConfig;

  @ApiPropertyOptional({ type: EmailConfig, description: '이메일 설정' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmailConfig)
  emailConfig?: EmailConfig;

  @ApiPropertyOptional({ type: SMSConfig, description: 'SMS 설정' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SMSConfig)
  smsConfig?: SMSConfig;

  @ApiPropertyOptional({ type: KakaoTemplateConfig, description: '카카오 템플릿 설정' })
  @IsOptional()
  @ValidateNested()
  @Type(() => KakaoTemplateConfig)
  kakaoTemplateConfig?: KakaoTemplateConfig;
}
