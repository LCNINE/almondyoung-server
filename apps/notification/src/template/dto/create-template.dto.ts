// apps/notification/src/template/dto/create-template.dto.ts
import { IsString, IsObject, IsOptional, IsEnum, IsArray, ValidateNested, IsBoolean, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { NotificationCategory } from '../../shared/enums';

// ===== FCM (Firebase Cloud Messaging) 관련 DTO =====
export class FCMNotificationConfig {
    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsString()
    body?: string;

    @IsOptional()
    @IsString()
    icon?: string; // 알림 아이콘

    @IsOptional()
    @IsString()
    color?: string; // 알림 색상 (예: #FF0000)

    @IsOptional()
    @IsString()
    sound?: string; // 알림 사운드

    @IsOptional()
    @IsString()
    tag?: string; // 알림 태그

    @IsOptional()
    @IsString()
    channelId?: string; // Android 채널 ID

    @IsOptional()
    @IsNumber()
    priority?: number; // 우선순위 (1-10)

    @IsOptional()
    @IsString()
    imageUrl?: string; // 알림 이미지 URL
}

export class FCMDataMessage {
    @IsObject()
    data: Record<string, string>; // 커스텀 데이터

    @IsOptional()
    @IsString()
    collapseKey?: string;

    @IsOptional()
    @IsNumber()
    ttl?: number; // Time to live (초)

    @IsOptional()
    @IsString()
    topic?: string; // FCM 토픽
}

export class FCMConfig {
    @IsOptional()
    @ValidateNested()
    @Type(() => FCMNotificationConfig)
    notification?: FCMNotificationConfig;

    @IsOptional()
    @ValidateNested()
    @Type(() => FCMDataMessage)
    data?: FCMDataMessage;

    @IsOptional()
    @IsString()
    clickAction?: string; // 클릭 시 액션

    @IsOptional()
    @IsString()
    link?: string; // 딥링크 URL
}

// ===== 이메일 관련 DTO =====
export class EmailAttachment {
    @IsString()
    filename: string;

    @IsString()
    content: string; // Base64 인코딩된 파일 내용

    @IsString()
    contentType: string; // MIME 타입

    @IsOptional()
    @IsString()
    cid?: string; // 인라인 이미지용 Content-ID
}

export class EmailConfig {
    @IsOptional()
    @IsString()
    htmlTemplate?: string; // HTML 템플릿

    @IsOptional()
    @IsString()
    textTemplate?: string; // 텍스트 템플릿

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => EmailAttachment)
    attachments?: EmailAttachment[];

    @IsOptional()
    @IsString()
    replyTo?: string; // 답장 주소

    @IsOptional()
    @IsString()
    fromName?: string; // 발신자 이름

    @IsOptional()
    @IsString()
    fromEmail?: string; // 발신자 이메일

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    cc?: string[]; // 참조

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    bcc?: string[]; // 숨은 참조

    @IsOptional()
    @IsString()
    priority?: 'high' | 'normal' | 'low'; // 우선순위
}

// ===== SMS 관련 DTO =====
export class SMSConfig {
    @IsOptional()
    @IsString()
    fromNumber?: string; // 발신번호

    @IsOptional()
    @IsBoolean()
    sendAsMms?: boolean; // MMS로 발송 여부

    @IsOptional()
    @IsString()
    validityPeriod?: string; // 유효기간

    @IsOptional()
    @IsString()
    maxPrice?: string; // 최대 가격

    @IsOptional()
    @IsBoolean()
    smartEncoded?: boolean; // 스마트 인코딩

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    mediaUrls?: string[]; // MMS 미디어 URL들
}

// ===== 카카오톡 관련 DTO (기존 확장) =====
export class KakaoTemplateButton {
    @IsString()
    ordering: string;

    @IsString()
    type: string; // WL, AL, DS, BK, MD, BC, BT, AC, BF, P1, P2, P3

    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    linkMo?: string;

    @IsOptional()
    @IsString()
    linkPc?: string;

    @IsOptional()
    @IsString()
    schemeIos?: string;

    @IsOptional()
    @IsString()
    schemeAndroid?: string;

    @IsOptional()
    bizFormId?: number;

    @IsOptional()
    @IsString()
    pluginId?: string;
}

export class KakaoTemplateItem {
    @IsString()
    title: string;

    @IsString()
    description: string;
}

export class KakaoTemplateItemList {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => KakaoTemplateItem)
    list: KakaoTemplateItem[];

    @IsOptional()
    @ValidateNested()
    @Type(() => KakaoTemplateItem)
    summary?: KakaoTemplateItem;
}

export class KakaoTemplateItemHighlight {
    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    imageUrl?: string;
}

export class KakaoTemplateRepresentLink {
    @IsOptional()
    @IsString()
    linkMo?: string;

    @IsOptional()
    @IsString()
    linkPc?: string;

    @IsOptional()
    @IsString()
    schemeIos?: string;

    @IsOptional()
    @IsString()
    schemeAndroid?: string;
}

export class KakaoTemplateConfig {
    @IsString()
    templateCode: string; // NHN에서 사용할 템플릿 코드 (최대 20자)

    @IsString()
    templateName: string; // NHN에서 사용할 템플릿명 (최대 150자)

    @IsString()
    templateContent: string; // 템플릿 본문 (최대 1000자)

    @IsOptional()
    @IsString()
    templateMessageType?: string; // BA, EX, AD, MI (기본: BA)

    @IsOptional()
    @IsString()
    templateEmphasizeType?: string; // NONE, TEXT, IMAGE, ITEM_LIST (기본: NONE)

    @IsOptional()
    @IsString()
    templateExtra?: string; // 부가 정보형/복합형일 경우 필수

    @IsOptional()
    @IsString()
    templateTitle?: string; // 최대 50자

    @IsOptional()
    @IsString()
    templateSubtitle?: string; // 최대 50자

    @IsOptional()
    @IsString()
    templateHeader?: string; // 최대 16자

    @IsOptional()
    @ValidateNested()
    @Type(() => KakaoTemplateItemList)
    templateItem?: KakaoTemplateItemList;

    @IsOptional()
    @ValidateNested()
    @Type(() => KakaoTemplateItemHighlight)
    templateItemHighlight?: KakaoTemplateItemHighlight;

    @IsOptional()
    @ValidateNested()
    @Type(() => KakaoTemplateRepresentLink)
    templateRepresentLink?: KakaoTemplateRepresentLink;

    @IsOptional()
    @IsString()
    templateImageName?: string;

    @IsOptional()
    @IsString()
    templateImageUrl?: string;

    @IsOptional()
    @IsBoolean()
    securityFlag?: boolean; // OTP 등 보안 메시지 여부

    @IsOptional()
    @IsString()
    categoryCode?: string; // 템플릿 카테고리 코드

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => KakaoTemplateButton)
    buttons?: KakaoTemplateButton[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => KakaoTemplateButton)
    quickReplies?: KakaoTemplateButton[];
}

// ===== 통합 템플릿 DTO =====
export class CreateTemplateDto {
    @IsString()
    templateKey: string;

    @IsString()
    name: string;

    @IsEnum(NotificationCategory)
    category: NotificationCategory; // 카테고리 필수

    @IsObject()
    contents: Record<string, Record<string, {
        subject?: string;
        body: string;
        metadata?: Record<string, any>;
    }>>;

    @IsObject()
    variablesSchema: Record<string, any>;

    @IsObject()
    @IsOptional()
    metadata?: Record<string, any>;

    // 지원하는 채널 목록
    @IsArray()
    @IsString({ each: true })
    supportedChannels: string[]; // ['EMAIL', 'KAKAO', 'SMS', 'PUSH']

    // ===== 채널별 고급 설정 =====
    @IsOptional()
    @ValidateNested()
    @Type(() => FCMConfig)
    fcmConfig?: FCMConfig;

    @IsOptional()
    @ValidateNested()
    @Type(() => EmailConfig)
    emailConfig?: EmailConfig;

    @IsOptional()
    @ValidateNested()
    @Type(() => SMSConfig)
    smsConfig?: SMSConfig;

    @IsOptional()
    @ValidateNested()
    @Type(() => KakaoTemplateConfig)
    kakaoTemplateConfig?: KakaoTemplateConfig;
}
