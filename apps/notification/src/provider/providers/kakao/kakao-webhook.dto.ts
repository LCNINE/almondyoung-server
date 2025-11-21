// apps/notification/src/provider/providers/kakao/kakao-webhook.dto.ts

/**
 * NHN KakaoTalk 웹훅 이벤트 DTO
 * 
 * NHN KakaoTalk API v2.3 웹훅 스펙 기반
 * https://docs.nhncloud.com/ko/Notification/KakaoTalk/ko/api-guide-v2.3/
 */

export interface KakaoWebhookPayload {
    hooksId: string;
    webhookConfigId: string;
    productName: string;
    appKey: string;
    event: KakaoWebhookEventType;
    hooks: KakaoWebhookHook[];
}

export type KakaoWebhookEventType =
    | 'MESSAGE_RESULT_UPDATE'  // 메시지 발송 결과 코드 업데이트
    | 'TEMPLATE_STATUS_UPDATE'; // 템플릿 상태/문의 업데이트

export type KakaoWebhookHook =
    | KakaoMessageResultUpdateHook
    | KakaoTemplateStatusUpdateHook;

/**
 * 메시지 발송 결과 업데이트 훅
 */
export interface KakaoMessageResultUpdateHook {
    hookId: string;
    kakaoMessageType: KakaoMessageType;
    requestId: string;
    recipientSeq: number;
    requestDate: string;
    createDate: string;
    receiveDate?: string;
    recipientNo: string;
    resultCode: string;
    resultCodeName?: string;
    senderGroupingKey?: string;
    recipientGroupingKey?: string;
    _links?: {
        self?: {
            href: string;
        };
    };
}

export type KakaoMessageType =
    | 'ALIMTALK_NORMAL'      // 알림톡 일반
    | 'ALIMTALK_AUTH'         // 알림톡 인증
    | 'ALIMTALK_MASS'         // 알림톡 대량
    | 'FRIENDTALK_NORMAL'     // 친구톡 일반
    | 'FRIENDTALK_MASS'       // 친구톡 대량
    | 'BRAND_MESSAGE_NORMAL'  // 브랜드 메시지 일반
    | 'BRAND_MESSAGE_MASS';   // 브랜드 메시지 대량

/**
 * 템플릿 상태/문의 업데이트 훅
 */
export interface KakaoTemplateStatusUpdateHook {
    hookId: string;
    senderKey: string;
    templateCode: string;
    kakaoTemplateCode?: string;
    status: KakaoTemplateStatus;
    comments?: KakaoTemplateComment[];
    updateDate: string;
}

export type KakaoTemplateStatus =
    | 'TSC01'  // 요청
    | 'TSC02'  // 검수 중
    | 'TSC03'  // 승인
    | 'TSC04'; // 반려

export interface KakaoTemplateComment {
    id: number;
    content: string;
    userName: string;
    createdAt: string;
    attachment?: Array<{
        originalFileName: string;
        filePath: string;
    }>;
    status: KakaoCommentStatus;
}

export type KakaoCommentStatus =
    | 'INQ'  // 문의
    | 'APR'  // 승인
    | 'REJ'  // 반려
    | 'REP'  // 답변
    | 'REQ'; // 검수 중

