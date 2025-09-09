// apps/notification/src/provider/providers/kakao/nhn.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
    NotificationProvider,
    NotificationMessage,
    NotificationResult,
    BulkNotificationResult,
} from '../../interfaces/notification-provider.interface';
import { StructuredLogger } from '../../../shared/utils/logger.utils';

interface NHNKakaoConfig {
    apiUrl: string;
    appKey: string;
    secretKey: string;
    senderKey: string;
    plusFriendId: string;
    resendAppKey?: string; // SMS 대체발송용 앱키
}

interface AlimtalkButton {
    ordering: number;
    type: string;
    name: string;
    linkMo?: string;
    linkPc?: string;
    schemeIos?: string;
    schemeAndroid?: string;
}

interface AlimtalkRecipient {
    recipientNo: string;
    templateParameter?: Record<string, string>;
    resendParameter?: {
        isResend: boolean;
        resendType?: 'SMS' | 'LMS';
        resendTitle?: string;
        resendContent?: string;
        resendSendNo?: string;
    };
    buttons?: AlimtalkButton[];
    recipientGroupingKey?: string;
}

interface AlimtalkSendRequest {
    senderKey: string;
    templateCode?: string;
    requestDate?: string;
    senderGroupingKey?: string;
    createUser?: string;
    recipientList: AlimtalkRecipient[];
    messageOption?: {
        price?: number;
        currencyType?: string;
    };
    statsId?: string;
}

interface AlimtalkRawMessage {
    senderKey: string;
    templateCode?: string;
    requestDate?: string;
    senderGroupingKey?: string;
    createUser?: string;
    recipientList: Array<{
        recipientNo: string;
        content: string;
        templateTitle?: string;
        buttons?: AlimtalkButton[];
        resendParameter?: {
            isResend: boolean;
            resendType?: 'SMS' | 'LMS';
            resendTitle?: string;
            resendContent?: string;
            resendSendNo?: string;
        };
        recipientGroupingKey?: string;
    }>;
    messageOption?: {
        price?: number;
        currencyType?: string;
    };
    statsId?: string;
}

@Injectable()
export class NHNProvider implements NotificationProvider {
    private readonly logger: StructuredLogger;
    private readonly providerId: string;
    private readonly config: NHNKakaoConfig;
    private readonly client: AxiosInstance;
    private isHealthy: boolean = true;

    constructor(
        providerId: string,
        config: Record<string, any>,
        private readonly configService: ConfigService,
    ) {
        this.logger = new StructuredLogger(new Logger(NHNProvider.name));
        this.providerId = providerId;

        // 설정 초기화 - DB config 우선, 없으면 환경변수
        this.config = {
            apiUrl: config.apiUrl || 'https://api-alimtalk.cloud.toast.com',
            appKey: config.appKey || '56ySy3UiPmNhryr8',
            secretKey: config.secretKey || 'p2CCuK4jPYJLZvydoVNEykYKOZb6IvkV',
            senderKey: config.senderKey || '4bd6430a65cad17d327c758006e5cf4a773d82e6',
            plusFriendId: config.plusFriendId || '@아몬드영',
            resendAppKey: config.resendAppKey || this.configService.get<string>('NHN_SMS_APP_KEY'),
        };

        // Axios 클라이언트 초기화
        this.client = axios.create({
            baseURL: this.config.apiUrl,
            timeout: config.timeout || 30000,
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'X-Secret-Key': this.config.secretKey,
            },
        });

        // 응답 인터셉터
        this.client.interceptors.response.use(
            (response) => response,
            (error) => {
                this.logger.error('NHN API Error', {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message,
                });
                throw error;
            }
        );
    }

    getName(): string {
        return 'NHN KakaoTalk';
    }

    getProviderId(): string {
        return this.providerId;
    }

    async isAvailable(): Promise<boolean> {
        try {
            // 템플릿 조회로 헬스체크
            const response = await this.client.get(
                `/alimtalk/v2.3/appkeys/${this.config.appKey}/senders/${this.config.senderKey}/templates`,
                {
                    params: { pageSize: 1 },
                }
            );

            this.isHealthy = response.data?.header?.isSuccessful || false;
            return this.isHealthy;
        } catch (error) {
            this.isHealthy = false;
            return false;
        }
    }

    async send(message: NotificationMessage): Promise<NotificationResult> {
        try {
            const metadata = message.metadata || {};
            const templateCode = metadata.templateCode;
            const templateParameters = metadata.templateParameters || {};
            const buttons = metadata.buttons || [];
            const resendSendNo = metadata.resendSendNo || this.configService.get<string>('DEFAULT_SMS_NUMBER');

            let response;

            if (templateCode) {
                // 템플릿 치환 발송
                const request: AlimtalkSendRequest = {
                    senderKey: this.config.senderKey,
                    templateCode,
                    recipientList: [{
                        recipientNo: this.formatPhoneNumber(message.to),
                        templateParameter: templateParameters,
                        resendParameter: {
                            isResend: true,
                            resendType: this.getResendType(message.content),
                            resendContent: message.content,
                            resendSendNo,
                        },
                        buttons: buttons.length > 0 ? buttons : undefined,
                    }],
                    statsId: metadata.statsId,
                };

                response = await this.client.post(
                    `/alimtalk/v2.3/appkeys/${this.config.appKey}/messages`,
                    request
                );
            } else {
                // 전문 발송
                const rawRequest: AlimtalkRawMessage = {
                    senderKey: this.config.senderKey,
                    recipientList: [{
                        recipientNo: this.formatPhoneNumber(message.to),
                        content: message.content,
                        templateTitle: message.subject,
                        buttons: buttons.length > 0 ? buttons : undefined,
                        resendParameter: {
                            isResend: true,
                            resendType: this.getResendType(message.content),
                            resendContent: message.content,
                            resendSendNo,
                        },
                    }],
                    statsId: metadata.statsId,
                };

                response = await this.client.post(
                    `/alimtalk/v2.3/appkeys/${this.config.appKey}/raw-messages`,
                    rawRequest
                );
            }

            const result = response.data;
            const sendResult = result.message?.sendResults?.[0];

            if (result.header?.isSuccessful && sendResult?.resultCode === 0) {
                return {
                    success: true,
                    messageId: result.message?.requestId,
                    providerResponse: result,
                };
            } else {
                return {
                    success: false,
                    error: sendResult?.resultMessage || result.header?.resultMessage || 'Unknown error',
                    providerResponse: result,
                };
            }
        } catch (error: any) {
            this.logger.error('Failed to send Kakao message', {
                to: message.to,
                error: error.message,
            });

            return {
                success: false,
                error: error.message,
                providerResponse: error.response?.data,
            };
        }
    }

    async sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult> {
        const results: NotificationResult[] = [];
        const failures: Array<{ to: string; error: string }> = [];
        let successCount = 0;
        let failureCount = 0;

        // NHN API는 한 요청에 최대 1000명까지 지원
        const BATCH_SIZE = 1000;

        for (let i = 0; i < messages.length; i += BATCH_SIZE) {
            const batch = messages.slice(i, i + BATCH_SIZE);

            try {
                // 템플릿 코드가 모두 동일한 경우 한번에 발송
                const firstMetadata = batch[0].metadata || {};
                const templateCode = firstMetadata.templateCode;
                const allSameTemplate = batch.every(m =>
                    (m.metadata?.templateCode || '') === templateCode
                );

                if (allSameTemplate && templateCode) {
                    // 동일 템플릿 일괄 발송
                    const result = await this.sendBulkWithTemplate(batch, templateCode);
                    successCount += result.successCount;
                    failureCount += result.failureCount;
                    if (result.failures) {
                        failures.push(...result.failures);
                    }
                } else {
                    // 개별 발송
                    for (const message of batch) {
                        const result = await this.send(message);
                        results.push(result);

                        if (result.success) {
                            successCount++;
                        } else {
                            failureCount++;
                            failures.push({
                                to: message.to,
                                error: result.error || 'Unknown error',
                            });
                        }
                    }
                }
            } catch (error: any) {
                this.logger.error('Bulk send batch failed', {
                    batchIndex: i / BATCH_SIZE,
                    error: error.message,
                });

                // 배치 실패 시 모든 메시지를 실패로 처리
                batch.forEach(message => {
                    failureCount++;
                    failures.push({
                        to: message.to,
                        error: 'Batch processing failed',
                    });
                });
            }
        }

        return {
            successCount,
            failureCount,
            results: results.length > 0 ? results : undefined,
            failures: failures.length > 0 ? failures : undefined,
        };
    }

    private async sendBulkWithTemplate(
        messages: NotificationMessage[],
        templateCode: string
    ): Promise<BulkNotificationResult> {
        try {
            const resendSendNo = this.configService.get<string>('DEFAULT_SMS_NUMBER');

            const recipientList: AlimtalkRecipient[] = messages.map(message => ({
                recipientNo: this.formatPhoneNumber(message.to),
                templateParameter: message.metadata?.templateParameters || {},
                resendParameter: {
                    isResend: true,
                    resendType: this.getResendType(message.content),
                    resendContent: message.content,
                    resendSendNo,
                },
                buttons: message.metadata?.buttons || undefined,
                recipientGroupingKey: message.metadata?.userId,
            }));

            const request: AlimtalkSendRequest = {
                senderKey: this.config.senderKey,
                templateCode,
                recipientList,
                statsId: messages[0].metadata?.statsId,
            };

            const response = await this.client.post(
                `/alimtalk/v2.3/appkeys/${this.config.appKey}/messages`,
                request
            );

            const result = response.data;
            const sendResults = result.message?.sendResults || [];

            let successCount = 0;
            let failureCount = 0;
            const failures: Array<{ to: string; error: string }> = [];

            sendResults.forEach((sendResult: any, index: number) => {
                if (sendResult.resultCode === 0) {
                    successCount++;
                } else {
                    failureCount++;
                    failures.push({
                        to: messages[index].to,
                        error: sendResult.resultMessage || 'Unknown error',
                    });
                }
            });

            return {
                successCount,
                failureCount,
                failures: failures.length > 0 ? failures : undefined,
            };
        } catch (error: any) {
            return {
                successCount: 0,
                failureCount: messages.length,
                failures: messages.map(m => ({
                    to: m.to,
                    error: error.message,
                })),
            };
        }
    }

    private formatPhoneNumber(phoneNumber: string): string {
        // 한국 전화번호 형식으로 변환
        let cleaned = phoneNumber.replace(/[^\d]/g, '');

        // 국제번호 형식 처리
        if (cleaned.startsWith('82')) {
            cleaned = '0' + cleaned.substring(2);
        } else if (cleaned.startsWith('+82')) {
            cleaned = '0' + cleaned.substring(3);
        }

        // 010-1234-5678 형식으로 변환
        if (cleaned.length === 11 && cleaned.startsWith('01')) {
            return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
        } else if (cleaned.length === 10 && cleaned.startsWith('01')) {
            return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
        }

        return phoneNumber;
    }

    private getResendType(content: string): 'SMS' | 'LMS' {
        // 90바이트 기준으로 SMS/LMS 구분
        const byteLength = Buffer.byteLength(content, 'utf8');
        return byteLength > 90 ? 'LMS' : 'SMS';
    }

    // 템플릿 관련 메서드들
    async createTemplate(template: any): Promise<any> {
        try {
            const response = await this.client.post(
                `/alimtalk/v2.3/appkeys/${this.config.appKey}/senders/${this.config.senderKey}/templates`,
                template
            );
            return response.data;
        } catch (error: any) {
            this.logger.error('Failed to create template', {
                error: error.message,
                response: error.response?.data,
            });
            throw error;
        }
    }

    async getTemplates(): Promise<any[]> {
        try {
            const response = await this.client.get(
                `/alimtalk/v2.3/appkeys/${this.config.appKey}/senders/${this.config.senderKey}/templates`
            );
            return response.data?.templateListResponse?.templates || [];
        } catch (error: any) {
            this.logger.error('Failed to get templates', {
                error: error.message,
            });
            return [];
        }
    }

    async getMessageStatus(requestId: string, recipientSeq?: number): Promise<any> {
        try {
            const url = recipientSeq !== undefined
                ? `/alimtalk/v2.3/appkeys/${this.config.appKey}/messages/${requestId}/${recipientSeq}`
                : `/alimtalk/v2.3/appkeys/${this.config.appKey}/messages?requestId=${requestId}`;

            const response = await this.client.get(url);
            return response.data;
        } catch (error: any) {
            this.logger.error('Failed to get message status', {
                requestId,
                error: error.message,
            });
            throw error;
        }
    }
}