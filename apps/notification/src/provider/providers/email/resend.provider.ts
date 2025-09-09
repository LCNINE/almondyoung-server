// apps/notification/src/provider/providers/email/resend.provider.ts
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
    NotificationProvider,
    NotificationMessage,
    NotificationResult,
    BulkNotificationResult,
} from '../../interfaces/notification-provider.interface';
import { StructuredLogger } from '../../../shared/utils/logger.utils';

interface ResendConfig {
    apiKey: string;
    fromEmail: string;
    fromName?: string;
    baseUrl?: string;
    maxRetries?: number;
    retryDelay?: number;
}

interface ResendEmailRequest {
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
        content?: string;
        filename: string;
        path?: string;
        content_type?: string;
        content_id?: string;
    }>;
    tags?: Array<{
        name: string;
        value: string;
    }>;
    scheduled_at?: string;
}

interface ResendBatchEmailRequest {
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

interface ResendEmailResponse {
    id: string;
    from: string;
    to: string | string[];
    created_at: string;
}

interface ResendBatchResponse {
    data: Array<{
        id: string;
    }>;
}

interface ResendErrorResponse {
    name: string;
    message: string;
    statusCode: number;
}

export class ResendProvider implements NotificationProvider {
    private readonly logger: StructuredLogger;
    private readonly providerId: string;
    private readonly config: ResendConfig;
    private readonly client: AxiosInstance;
    private isHealthy: boolean = true;
    private lastHealthCheckTime: number = 0;
    private readonly healthCheckInterval = 60000; // 1분

    constructor(
        providerId: string,
        config: Record<string, any>,
        private readonly configService: ConfigService,
    ) {
        this.logger = new StructuredLogger(new Logger(ResendProvider.name));
        this.providerId = providerId;

        // 설정 초기화 - DB config 우선, 없으면 환경변수
        this.config = {
            apiKey: config.apiKey ?? this.configService.get<string>('RESEND_API_KEY')!, // ← 필수
            fromEmail: config.fromEmail ?? this.configService.get<string>('RESEND_FROM') ?? 'noreply@almondyoung.com',
            fromName: config.fromName ?? this.configService.get<string>('RESEND_FROM_NAME') ?? 'Almond Young',
            baseUrl: config.baseUrl ?? 'https://api.resend.com',
            maxRetries: config.maxRetries ?? 3,
            retryDelay: config.retryDelay ?? 1000,
        };
        if (!this.config.apiKey) throw new Error('RESEND_API_KEY missing');


        // Axios 클라이언트 초기화
        this.client = axios.create({
            baseURL: this.config.baseUrl,
            timeout: config.timeout || 30000,
            headers: {
                'Authorization': `Bearer ${this.config.apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        // Rate limiting을 위한 인터셉터
        this.setupInterceptors();
    }

    private setupInterceptors() {
        // Request 인터셉터 - 요청 로깅
        this.client.interceptors.request.use(
            (config) => {
                this.logger.log('Resend API Request', {
                    method: config.method,
                    url: config.url,
                    headers: {
                        ...config.headers,
                        Authorization: 'Bearer [REDACTED]',
                    },
                });
                return config;
            },
            (error) => {
                this.logger.error('Request setup failed', { error: error.message });
                return Promise.reject(error);
            }
        );

        // Response 인터셉터 - 에러 처리 및 재시도
        this.client.interceptors.response.use(
            (response) => {
                this.logger.log('Resend API Response', {
                    status: response.status,
                    headers: response.headers,
                });
                return response;
            },
            async (error: AxiosError) => {
                const originalRequest = error.config as any;

                // Rate limit 처리
                if (error.response?.status === 429) {
                    const retryAfter = error.response.headers['retry-after'];
                    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000;

                    this.logger.warn('Rate limit hit, retrying', {
                        waitTime,
                        retryAfter: error.response.headers['retry-after'],
                        rateLimitRemaining: error.response.headers['ratelimit-remaining'],
                        rateLimitReset: error.response.headers['ratelimit-reset'],
                    });

                    // 재시도 횟수 체크
                    originalRequest._retryCount = originalRequest._retryCount || 0;
                    if (originalRequest._retryCount < this.config.maxRetries!) {
                        originalRequest._retryCount++;
                        await this.delay(waitTime);
                        return this.client(originalRequest);
                    }
                }

                // 500번대 에러 재시도
                if (error.response?.status && error.response.status >= 500) {
                    originalRequest._retryCount = originalRequest._retryCount || 0;
                    if (originalRequest._retryCount < this.config.maxRetries!) {
                        originalRequest._retryCount++;
                        await this.delay(this.config.retryDelay! * (originalRequest._retryCount + 1));
                        return this.client(originalRequest);
                    }
                }

                this.logger.error('Resend API Error', {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message,
                });

                throw error;
            }
        );
    }

    getName(): string {
        return 'Resend Email';
    }

    getProviderId(): string {
        return this.providerId;
    }

    async isAvailable(): Promise<boolean> {
        // 캐싱된 헬스 체크 결과 사용 (1분 간격)
        const now = Date.now();
        if (now - this.lastHealthCheckTime < this.healthCheckInterval) {
            return this.isHealthy;
        }

        try {
            // API Key 검증을 위해 도메인 목록 조회
            const response = await this.client.get('/domains', {
                timeout: 5000,
            });

            this.isHealthy = response.status === 200;
            this.lastHealthCheckTime = now;

            return this.isHealthy;
        } catch (error: any) {
            // 403은 API 키는 유효하지만 권한이 없는 경우 (Sending access only)
            // 이 경우에도 이메일 발송은 가능하므로 healthy로 처리
            if (error.response?.status === 403) {
                this.isHealthy = true;
                this.lastHealthCheckTime = now;
                return true;
            }

            this.isHealthy = false;
            this.lastHealthCheckTime = now;
            return false;
        }
    }

    async send(message: NotificationMessage): Promise<NotificationResult> {
        try {
            const metadata = message.metadata || {};

            // From 주소 구성
            const from = this.formatFromAddress(
                metadata.fromEmail || this.config.fromEmail,
                metadata.fromName || this.config.fromName
            );

            // 이메일 요청 구성
            const emailRequest: ResendEmailRequest = {
                from,
                to: message.to,
                subject: message.subject || 'Notification',
                html: message.content,
                text: metadata.text,
                cc: metadata.cc,
                bcc: metadata.bcc,
                reply_to: metadata.replyTo || metadata.fromEmail || this.config.fromEmail,
                headers: metadata.headers,
                attachments: metadata.attachments,
                tags: this.buildTags(metadata),
                scheduled_at: metadata.scheduledAt,
            };

            // 빈 필드 제거
            Object.keys(emailRequest).forEach(key => {
                if (emailRequest[key as keyof ResendEmailRequest] === undefined) {
                    delete emailRequest[key as keyof ResendEmailRequest];
                }
            });

            const response = await this.client.post<ResendEmailResponse>(
                '/emails',
                emailRequest,
                {
                    headers: metadata.idempotencyKey ? {
                        'Idempotency-Key': metadata.idempotencyKey,
                    } : undefined,
                }
            );

            return {
                success: true,
                messageId: response.data.id,
                providerResponse: response.data,
            };
        } catch (error: any) {
            return this.handleError(error, message.to);
        }
    }

    async sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult> {
        // Resend는 한 번에 최대 100개까지 배치 전송 지원
        const BATCH_SIZE = 100;
        const results: NotificationResult[] = [];
        const failures: Array<{ to: string; error: string }> = [];
        let successCount = 0;
        let failureCount = 0;

        for (let i = 0; i < messages.length; i += BATCH_SIZE) {
            const batch = messages.slice(i, i + BATCH_SIZE);

            try {
                // 배치 이메일 요청 구성
                const batchRequests: ResendBatchEmailRequest[] = batch.map(message => {
                    const metadata = message.metadata || {};
                    const from = this.formatFromAddress(
                        metadata.fromEmail || this.config.fromEmail,
                        metadata.fromName || this.config.fromName
                    );

                    return {
                        from,
                        to: message.to,
                        subject: message.subject || 'Notification',
                        html: message.content,
                        text: metadata.text,
                        cc: metadata.cc,
                        bcc: metadata.bcc,
                        reply_to: metadata.replyTo || metadata.fromEmail || this.config.fromEmail,
                        headers: metadata.headers,
                    };
                });

                const response = await this.client.post<ResendBatchResponse>(
                    '/emails/batch',
                    batchRequests
                );

                // 성공 처리
                if (response.data?.data) {
                    successCount += response.data.data.length;
                    response.data.data.forEach((item, index) => {
                        results.push({
                            success: true,
                            messageId: item.id,
                            providerResponse: item,
                        });
                    });
                }
            } catch (error: any) {
                this.logger.error('Batch send failed', {
                    batchIndex: i / BATCH_SIZE,
                    error: error.message,
                    response: error.response?.data,
                });

                // 배치 전체 실패 처리
                batch.forEach(message => {
                    failureCount++;
                    failures.push({
                        to: Array.isArray(message.to) ? message.to.join(',') : message.to,
                        error: this.extractErrorMessage(error),
                    });
                });
            }

            // Rate limit 회피를 위한 지연
            if (i + BATCH_SIZE < messages.length) {
                await this.delay(500); // 0.5초 대기
            }
        }

        return {
            successCount,
            failureCount,
            results: results.length > 0 ? results : undefined,
            failures: failures.length > 0 ? failures : undefined,
        };
    }

    private formatFromAddress(email: string, name?: string): string {
        if (!name) {
            return email;
        }
        return `${name} <${email}>`;
    }

    private buildTags(metadata: any): Array<{ name: string; value: string }> | undefined {
        const tags: Array<{ name: string; value: string }> = [];

        // 기본 태그 추가
        if (metadata.userId) {
            tags.push({ name: 'user_id', value: metadata.userId });
        }
        if (metadata.notificationId) {
            tags.push({ name: 'notification_id', value: metadata.notificationId });
        }
        if (metadata.campaignId) {
            tags.push({ name: 'campaign_id', value: metadata.campaignId });
        }
        if (metadata.category) {
            tags.push({ name: 'category', value: metadata.category });
        }

        // 커스텀 태그 추가
        if (metadata.tags) {
            Object.entries(metadata.tags).forEach(([name, value]) => {
                if (typeof value === 'string') {
                    tags.push({ name, value });
                }
            });
        }

        return tags.length > 0 ? tags : undefined;
    }

    private handleError(error: any, to: string | string[]): NotificationResult {
        const errorResponse = error.response?.data as ResendErrorResponse;
        const recipient = Array.isArray(to) ? to.join(',') : to;

        this.logger.error('Failed to send email', {
            to: recipient,
            error: errorResponse?.message || error.message,
            statusCode: error.response?.status,
        });

        return {
            success: false,
            error: this.extractErrorMessage(error),
            providerResponse: errorResponse || error.response?.data,
        };
    }

    private extractErrorMessage(error: any): string {
        const errorResponse = error.response?.data as ResendErrorResponse;

        if (errorResponse?.message) {
            return errorResponse.message;
        }

        switch (error.response?.status) {
            case 400:
                return 'Invalid request parameters';
            case 401:
                return 'Invalid API key';
            case 403:
                return 'Access denied - check API key permissions';
            case 404:
                return 'Resource not found';
            case 422:
                return 'Invalid email format or content';
            case 429:
                return 'Rate limit exceeded';
            case 500:
                return 'Resend server error';
            default:
                return error.message || 'Unknown error';
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 추가 기능: 이메일 상태 조회
    async getEmailStatus(emailId: string): Promise<any> {
        try {
            const response = await this.client.get(`/emails/${emailId}`);
            return response.data;
        } catch (error: any) {
            this.logger.error('Failed to get email status', {
                emailId,
                error: error.message,
            });
            throw error;
        }
    }

    // 추가 기능: 예약된 이메일 업데이트
    async updateScheduledEmail(emailId: string, scheduledAt: string): Promise<any> {
        try {
            const response = await this.client.patch(`/emails/${emailId}`, {
                scheduled_at: scheduledAt,
            });
            return response.data;
        } catch (error: any) {
            this.logger.error('Failed to update scheduled email', {
                emailId,
                error: error.message,
            });
            throw error;
        }
    }

    // 추가 기능: 예약된 이메일 취소
    async cancelScheduledEmail(emailId: string): Promise<any> {
        try {
            const response = await this.client.post(`/emails/${emailId}/cancel`);
            return response.data;
        } catch (error: any) {
            this.logger.error('Failed to cancel scheduled email', {
                emailId,
                error: error.message,
            });
            throw error;
        }
    }
}