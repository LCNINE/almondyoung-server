// apps/notification/src/provider/providers/sms/twilio.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    NotificationProvider,
    NotificationMessage,
    NotificationResult,
    BulkNotificationResult
} from '../../interfaces/notification-provider.interface';
import * as twilio from 'twilio';

@Injectable()
export class TwilioProvider implements NotificationProvider {
    private readonly logger = new Logger(TwilioProvider.name);
    private readonly client?: twilio.Twilio;
    private readonly fromNumber?: string;
    private readonly messagingServiceSid?: string;
    private readonly providerId = 'twilio-sms';
    private readonly isConfigured: boolean;
    private readonly useTestCredentials: boolean;

    constructor(
        private readonly configService: ConfigService,
    ) {
        const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
        const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');

        // 테스트 자격 증명 사용 여부
        this.useTestCredentials = this.configService.get<boolean>('TWILIO_USE_TEST_CREDENTIALS', false);

        // Messaging Service 또는 From Number
        this.messagingServiceSid = this.configService.get<string>('TWILIO_MESSAGING_SERVICE_SID');
        this.fromNumber = this.configService.get<string>('TWILIO_FROM_NUMBER');

        if (accountSid && authToken && (this.fromNumber || this.messagingServiceSid)) {
            this.client = twilio(accountSid, authToken);
            this.isConfigured = true;

            if (this.useTestCredentials) {
                this.logger.warn('Using Twilio test credentials - messages will not be sent');
            }
        } else {
            this.logger.warn('Twilio provider is not configured properly. Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID');
            this.isConfigured = false;
        }
    }

    getName(): string {
        return 'Twilio';
    }

    getProviderId(): string {
        return this.providerId;
    }

    async isAvailable(): Promise<boolean> {
        if (!this.isConfigured || !this.client) {
            return false;
        }

        try {
            // Account 정보 조회로 연결 테스트
            const account = await this.client.api.accounts(this.client.accountSid).fetch();
            return account.status === 'active';
        } catch (error) {
            this.logger.error('Twilio availability check failed', error);
            return false;
        }
    }

    async send(message: NotificationMessage): Promise<NotificationResult> {
        if (!this.isConfigured || !this.client) {
            return {
                success: false,
                error: 'Twilio provider is not configured',
            };
        }

        try {
            const messageOptions: any = {
                to: this.formatPhoneNumber(message.to),
                body: message.content,
            };

            // MessagingServiceSid가 있으면 우선 사용, 없으면 From number 사용
            if (this.messagingServiceSid) {
                messageOptions.messagingServiceSid = this.messagingServiceSid;
            } else {
                messageOptions.from = this.fromNumber;
            }

            // 테스트 모드에서는 특별한 번호 사용
            if (this.useTestCredentials) {
                messageOptions.from = '+15005550006'; // Twilio 테스트용 magic number
                this.logger.debug('Using test credentials', messageOptions);
            }

            // StatusCallback URL 설정 (옵션)
            const statusCallbackUrl = this.configService.get<string>('TWILIO_STATUS_CALLBACK_URL');
            if (statusCallbackUrl) {
                messageOptions.statusCallback = statusCallbackUrl;
            }

            // 메타데이터를 Twilio 메시지에 포함 (최대 10개의 custom parameters)
            if (message.metadata) {
                const customParams = this.buildCustomParameters(message.metadata);
                Object.assign(messageOptions, customParams);
            }

            const twilioMessage = await this.client.messages.create(messageOptions);

            return {
                success: true,
                messageId: twilioMessage.sid,
                providerResponse: {
                    sid: twilioMessage.sid,
                    status: twilioMessage.status,
                    dateCreated: twilioMessage.dateCreated,
                    price: twilioMessage.price,
                    priceUnit: twilioMessage.priceUnit,
                },
            };
        } catch (error: any) {
            this.logger.error(`Twilio send failed: ${error.message}`);

            // Twilio 에러 코드 처리
            const errorCode = error.code;
            const errorMessage = this.mapTwilioErrorCode(errorCode) || error.message;

            return {
                success: false,
                error: errorMessage,
                providerResponse: {
                    errorCode,
                    moreInfo: error.moreInfo,
                },
            };
        }
    }

    async sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult> {
        if (!this.isConfigured || !this.client) {
            return {
                successCount: 0,
                failureCount: messages.length,
                failures: messages.map(msg => ({
                    to: msg.to,
                    error: 'Twilio provider is not configured',
                })),
            };
        }

        // Twilio는 native bulk API가 없으므로 병렬 처리
        const results = await Promise.allSettled(
            messages.map(msg => this.send(msg))
        );

        let successCount = 0;
        let failureCount = 0;
        const failures: Array<{ to: string; error: string }> = [];

        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.success) {
                successCount++;
            } else {
                failureCount++;
                failures.push({
                    to: messages[index].to,
                    error: result.status === 'rejected'
                        ? result.reason.message
                        : (result.value as NotificationResult).error || 'Unknown error',
                });
            }
        });

        return {
            successCount,
            failureCount,
            failures,
        };
    }

    private formatPhoneNumber(phone: string): string {
        // E.164 형식으로 변환
        let formatted = phone.replace(/\D/g, '');

        // 한국 번호 처리
        if (formatted.startsWith('82')) {
            return `+${formatted}`;
        } else if (formatted.startsWith('010') || formatted.startsWith('011')) {
            return `+82${formatted.substring(1)}`;
        }

        // 이미 +로 시작하면 그대로 반환
        if (phone.startsWith('+')) {
            return phone;
        }

        // 기본적으로 + 추가
        return `+${formatted}`;
    }

    private buildCustomParameters(metadata: Record<string, any>): Record<string, string> {
        const customParams: Record<string, string> = {};
        const allowedKeys = ['notificationId', 'campaignId', 'category', 'userId'];

        // Twilio는 custom parameter를 제한적으로 지원
        allowedKeys.forEach(key => {
            if (metadata[key]) {
                // Twilio webhook에서 이 값들을 받을 수 있음
                customParams[`custom_${key}`] = String(metadata[key]);
            }
        });

        return customParams;
    }

    private mapTwilioErrorCode(code?: number): string | null {
        if (!code) return null;

        const errorMap: Record<number, string> = {
            21211: 'Invalid To phone number',
            21212: 'Invalid From phone number',
            21408: 'Permission to send to this country denied',
            21610: 'Message blocked - number is on stop list',
            21611: 'SMS queue is full',
            21612: 'Cannot route to this number',
            21614: 'Number is incapable of receiving SMS',
            30003: 'Messaging Service not configured properly',
            30004: 'Message blocked',
            30005: 'Unknown destination',
            30006: 'Landline or unreachable carrier',
            30007: 'Carrier violation',
            30008: 'Unknown error',
        };

        return errorMap[code] || null;
    }
}