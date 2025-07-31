// apps/notification/src/provider/providers/email/resend.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    NotificationProvider,
    NotificationMessage,
    NotificationResult,
    BulkNotificationResult
} from '../../interfaces/notification-provider.interface';

interface ResendEmailPayload {
    from: string;
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    bcc?: string | string[];
    cc?: string | string[];
    reply_to?: string | string[];
    headers?: Record<string, string>;
    attachments?: Array<{
        content: string;
        filename: string;
        content_type?: string;
    }>;
    tags?: Array<{
        name: string;
        value: string;
    }>;
    scheduled_at?: string;
}

interface ResendBatchPayload {
    from: string;
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    bcc?: string | string[];
    cc?: string | string[];
    reply_to?: string | string[];
    headers?: Record<string, string>;
}

@Injectable()
export class ResendProvider implements NotificationProvider {
    private readonly logger = new Logger(ResendProvider.name);
    private readonly apiKey?: string;
    private readonly fromEmail: string;
    private readonly fromName?: string;
    private readonly providerId = 'resend-email';
    private readonly isConfigured: boolean;
    private readonly baseUrl = 'https://api.resend.com';

    constructor(
        private readonly configService: ConfigService,
    ) {
        this.apiKey = this.configService.get<string>('RESEND_API_KEY');
        this.fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL', 'noreply@example.com');
        this.fromName = this.configService.get<string>('RESEND_FROM_NAME');

        this.isConfigured = !!this.apiKey;

        if (!this.isConfigured) {
            this.logger.warn('Resend provider is not configured. RESEND_API_KEY is missing');
        }
    }

    getName(): string {
        return 'Resend';
    }

    getProviderId(): string {
        return this.providerId;
    }

    async isAvailable(): Promise<boolean> {
        if (!this.isConfigured) {
            return false;
        }

        try {
            // API Keys 엔드포인트로 연결 테스트
            const response = await fetch(`${this.baseUrl}/api-keys`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
            });

            return response.ok;
        } catch (error) {
            this.logger.error('Resend availability check failed', error);
            return false;
        }
    }

    async send(message: NotificationMessage): Promise<NotificationResult> {
        if (!this.isConfigured) {
            return {
                success: false,
                error: 'Resend provider is not configured',
            };
        }

        try {
            const from = this.fromName
                ? `${this.fromName} <${this.fromEmail}>`
                : this.fromEmail;

            const payload: ResendEmailPayload = {
                from,
                to: message.to,
                subject: message.subject || 'Notification',
                html: message.content,
                tags: this.buildTags(message.metadata),
            };

            // 예약 발송
            if (message.metadata?.scheduledAt) {
                payload.scheduled_at = message.metadata.scheduledAt;
            }

            const response = await fetch(`${this.baseUrl}/emails`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            if (response.ok) {
                return {
                    success: true,
                    messageId: data.id,
                    providerResponse: data,
                };
            } else {
                return {
                    success: false,
                    error: data.message || data.error || 'Unknown error',
                    providerResponse: data,
                };
            }
        } catch (error: any) {
            this.logger.error(`Resend send failed: ${error.message}`);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    async sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult> {
        if (!this.isConfigured) {
            return {
                successCount: 0,
                failureCount: messages.length,
                failures: messages.map(msg => ({
                    to: msg.to,
                    error: 'Resend provider is not configured',
                })),
            };
        }

        try {
            // Resend는 batch 엔드포인트로 최대 100개까지 전송 가능
            const chunks = this.chunkArray(messages, 100);
            let totalSuccess = 0;
            let totalFailure = 0;
            const failures: Array<{ to: string; error: string }> = [];

            for (const chunk of chunks) {
                const from = this.fromName
                    ? `${this.fromName} <${this.fromEmail}>`
                    : this.fromEmail;

                const batchPayload = chunk.map(msg => ({
                    from,
                    to: msg.to,
                    subject: msg.subject || 'Notification',
                    html: msg.content,
                    headers: {
                        'X-Notification-Id': msg.metadata?.notificationId || '',
                        'X-Campaign-Id': msg.metadata?.campaignId || '',
                        'X-Category': msg.metadata?.category || '',
                    },
                }));

                const response = await fetch(`${this.baseUrl}/emails/batch`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(batchPayload),
                });

                const data = await response.json();

                if (response.ok && data.data) {
                    // Resend batch response 구조에 따라 처리
                    data.data.forEach((result: any, index: number) => {
                        if (result.id) {
                            totalSuccess++;
                        } else {
                            totalFailure++;
                            failures.push({
                                to: chunk[index].to,
                                error: result.error || 'Failed to send',
                            });
                        }
                    });
                } else {
                    // 전체 실패
                    totalFailure += chunk.length;
                    chunk.forEach(msg => {
                        failures.push({
                            to: msg.to,
                            error: data.message || data.error || 'Batch send failed',
                        });
                    });
                }
            }

            return {
                successCount: totalSuccess,
                failureCount: totalFailure,
                failures,
            };
        } catch (error: any) {
            this.logger.error(`Resend bulk send failed: ${error.message}`);
            return {
                successCount: 0,
                failureCount: messages.length,
                failures: messages.map(msg => ({
                    to: msg.to,
                    error: error.message,
                })),
            };
        }
    }

    private buildTags(metadata?: Record<string, any>): Array<{ name: string; value: string }> | undefined {
        if (!metadata) return undefined;

        const tags: Array<{ name: string; value: string }> = [];

        // 주요 메타데이터를 태그로 변환
        const allowedKeys = ['notificationId', 'campaignId', 'category', 'userId', 'priority'];

        for (const key of allowedKeys) {
            if (metadata[key]) {
                // Resend 태그 제한사항: ASCII 문자, 숫자, _, - 만 허용, 최대 256자
                const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 256);
                const sanitizedValue = String(metadata[key])
                    .replace(/[^a-zA-Z0-9_-]/g, '_')
                    .substring(0, 256);

                tags.push({
                    name: sanitizedKey,
                    value: sanitizedValue,
                });
            }
        }

        return tags.length > 0 ? tags : undefined;
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}