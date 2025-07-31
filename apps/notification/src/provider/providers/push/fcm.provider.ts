// apps/notification/src/provider/providers/push/fcm.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import {
    NotificationProvider,
    NotificationMessage,
    NotificationResult,
    BulkNotificationResult
} from '../../interfaces/notification-provider.interface';

// FCM v1 API 메시지 타입 정의
interface FcmV1Message {
    name?: string;
    data?: { [key: string]: string };
    notification?: {
        title?: string;
        body?: string;
        image?: string;
    };
    android?: {
        collapse_key?: string;
        priority?: 'normal' | 'high';
        ttl?: string;
        restricted_package_name?: string;
        data?: { [key: string]: string };
        notification?: {
            title?: string;
            body?: string;
            icon?: string;
            color?: string;
            sound?: string;
            tag?: string;
            click_action?: string;
            channel_id?: string;
            notification_priority?: 'PRIORITY_MIN' | 'PRIORITY_LOW' | 'PRIORITY_DEFAULT' | 'PRIORITY_HIGH' | 'PRIORITY_MAX';
            default_sound?: boolean;
            default_vibrate_timings?: boolean;
            default_light_settings?: boolean;
            image?: string;
        };
        fcm_options?: {
            analytics_label?: string;
        };
        direct_boot_ok?: boolean;
    };
    apns?: {
        headers?: { [key: string]: string };
        payload?: {
            aps?: {
                alert?: {
                    title?: string;
                    body?: string;
                };
                badge?: number;
                sound?: string;
                'content-available'?: number;
                category?: string;
                'thread-id'?: string;
            };
            [key: string]: any;
        };
        fcm_options?: {
            analytics_label?: string;
            image?: string;
        };
    };
    webpush?: {
        headers?: { [key: string]: string };
        data?: { [key: string]: string };
        notification?: any;
        fcm_options?: {
            link?: string;
            analytics_label?: string;
        };
    };
    fcm_options?: {
        analytics_label?: string;
    };
    token?: string;
    topic?: string;
    condition?: string;
}

@Injectable()
export class FCMProvider implements NotificationProvider {
    private readonly logger = new Logger(FCMProvider.name);
    private readonly app?: admin.app.App;
    private readonly auth?: any;
    private readonly projectId?: string;
    private readonly providerId = 'fcm-push';
    private readonly isConfigured: boolean;
    private readonly fcmApiUrl = 'https://fcm.googleapis.com/v1';

    constructor(private readonly configService: ConfigService) {
        const serviceAccountString = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT');

        if (serviceAccountString) {
            try {
                const serviceAccount = JSON.parse(serviceAccountString);
                this.projectId = serviceAccount.project_id;

                // Firebase Admin SDK 초기화 (레거시 API 및 토큰 관리용)
                this.app = admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                    projectId: this.projectId,
                });

                // Google Auth 라이브러리 초기화 (FCM v1 API용)
                this.auth = new google.auth.GoogleAuth({
                    credentials: serviceAccount,
                    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
                });

                this.isConfigured = true;
                this.logger.log('FCM provider configured successfully');
            } catch (error: any) {
                this.logger.error('Failed to initialize FCM', error);
                this.isConfigured = false;
            }
        } else {
            this.logger.warn('FCM provider is not configured. FIREBASE_SERVICE_ACCOUNT is missing');
            this.isConfigured = false;
        }
    }

    getName(): string {
        return 'Firebase Cloud Messaging';
    }

    getProviderId(): string {
        return this.providerId;
    }

    async isAvailable(): Promise<boolean> {
        if (!this.isConfigured || !this.app) {
            return false;
        }

        try {
            // 간단한 토큰 검증으로 서비스 확인
            const testToken = await this.auth.getAccessToken();
            return !!testToken;
        } catch (error) {
            this.logger.error('FCM availability check failed', error);
            return false;
        }
    }

    async send(message: NotificationMessage): Promise<NotificationResult> {
        if (!this.isConfigured || !this.auth || !this.projectId) {
            return {
                success: false,
                error: 'FCM provider is not configured',
            };
        }

        try {
            // FCM v1 메시지 구성
            const fcmMessage: FcmV1Message = this.buildFcmMessage(message);

            // Access token 획득
            const accessToken = await this.auth.getAccessToken();

            // FCM v1 API로 전송
            const response = await fetch(
                `${this.fcmApiUrl}/projects/${this.projectId}/messages:send`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        validate_only: false,
                        message: fcmMessage,
                    }),
                }
            );

            const responseData = await response.json();

            if (response.ok && responseData.name) {
                return {
                    success: true,
                    messageId: responseData.name,
                    providerResponse: responseData,
                };
            } else {
                const errorCode = responseData.error?.details?.[0]?.['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError'
                    ? responseData.error.details[0].error_code
                    : responseData.error?.code;

                return {
                    success: false,
                    error: this.mapFcmErrorCode(errorCode) || responseData.error?.message || 'Unknown error',
                    providerResponse: responseData,
                };
            }
        } catch (error: any) {
            this.logger.error(`FCM send failed: ${error.message}`);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    async sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult> {
        if (!this.isConfigured || !this.auth) {
            return {
                successCount: 0,
                failureCount: messages.length,
                failures: messages.map(msg => ({
                    to: msg.to,
                    error: 'FCM provider is not configured',
                })),
            };
        }

        // FCM v1 API는 배치 전송을 직접 지원하지 않으므로 병렬 처리
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

    private buildFcmMessage(message: NotificationMessage): FcmV1Message {
        const fcmMessage: FcmV1Message = {
            token: message.to, // FCM 등록 토큰
            notification: {
                title: message.subject || 'Notification',
                body: message.content,
            },
            data: this.sanitizeData({
                ...message.metadata,
                // 클릭 액션 등 추가 데이터
                click_action: message.metadata?.clickAction || 'FLUTTER_NOTIFICATION_CLICK',
            }),
        };

        // 이미지가 있는 경우
        if (message.metadata?.image) {
            fcmMessage.notification!.image = message.metadata.image;
        }

        // Android 특정 설정
        fcmMessage.android = {
            priority: message.metadata?.priority === 'urgent' ? 'high' : 'normal',
            ttl: message.metadata?.ttl || '3600s', // 기본 1시간
            notification: {
                channel_id: message.metadata?.channelId || 'default',
                click_action: message.metadata?.clickAction,
                tag: message.metadata?.tag,
                notification_priority: this.mapNotificationPriority(message.metadata?.priority),
            },
            fcm_options: {
                analytics_label: message.metadata?.analyticsLabel || message.metadata?.category,
            },
        };

        // iOS(APNs) 특정 설정
        fcmMessage.apns = {
            headers: {
                'apns-priority': message.metadata?.priority === 'urgent' ? '10' : '5',
                'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600), // 1시간 후
            },
            payload: {
                aps: {
                    alert: {
                        title: message.subject || 'Notification',
                        body: message.content,
                    },
                    badge: message.metadata?.badge,
                    sound: message.metadata?.sound || 'default',
                    'content-available': message.metadata?.contentAvailable ? 1 : undefined,
                    category: message.metadata?.category,
                },
            },
            fcm_options: {
                analytics_label: message.metadata?.analyticsLabel || message.metadata?.category,
                image: message.metadata?.image,
            },
        };

        // Web Push 특정 설정
        if (message.metadata?.webpush) {
            fcmMessage.webpush = {
                headers: {
                    TTL: message.metadata?.ttl || '3600',
                },
                notification: {
                    title: message.subject || 'Notification',
                    body: message.content,
                    icon: message.metadata?.icon,
                    badge: message.metadata?.badge,
                    image: message.metadata?.image,
                },
                fcm_options: {
                    link: message.metadata?.link,
                    analytics_label: message.metadata?.analyticsLabel || message.metadata?.category,
                },
            };
        }

        // FCM 옵션
        fcmMessage.fcm_options = {
            analytics_label: message.metadata?.analyticsLabel || message.metadata?.category,
        };

        return fcmMessage;
    }

    private sanitizeData(data: Record<string, any>): Record<string, string> {
        const sanitized: Record<string, string> = {};

        for (const [key, value] of Object.entries(data)) {
            // FCM 예약어 필터링
            if (!this.isReservedKey(key) && value !== null && value !== undefined) {
                sanitized[key] = String(value);
            }
        }

        return sanitized;
    }

    private isReservedKey(key: string): boolean {
        const reservedPrefixes = ['google.', 'gcm.'];
        const reservedKeys = ['from', 'message_type'];

        return reservedKeys.includes(key) ||
            reservedPrefixes.some(prefix => key.startsWith(prefix));
    }

    private mapNotificationPriority(priority?: string): 'PRIORITY_MIN' | 'PRIORITY_LOW' | 'PRIORITY_DEFAULT' | 'PRIORITY_HIGH' | 'PRIORITY_MAX' {
        switch (priority) {
            case 'urgent':
                return 'PRIORITY_MAX';
            case 'high':
                return 'PRIORITY_HIGH';
            case 'low':
                return 'PRIORITY_LOW';
            case 'min':
                return 'PRIORITY_MIN';
            default:
                return 'PRIORITY_DEFAULT';
        }
    }

    private mapFcmErrorCode(errorCode?: string): string | null {
        if (!errorCode) return null;

        const errorMap: Record<string, string> = {
            'INVALID_ARGUMENT': 'Invalid registration token or request parameters',
            'UNREGISTERED': 'App instance was unregistered from FCM',
            'SENDER_ID_MISMATCH': 'The authenticated sender ID is different from the sender ID for the registration token',
            'QUOTA_EXCEEDED': 'Sending limit exceeded',
            'UNAVAILABLE': 'FCM server is temporarily unavailable',
            'INTERNAL': 'Internal server error',
            'THIRD_PARTY_AUTH_ERROR': 'APNs certificate or web push auth key was invalid or missing',
        };

        return errorMap[errorCode] || `FCM Error: ${errorCode}`;
    }
}
