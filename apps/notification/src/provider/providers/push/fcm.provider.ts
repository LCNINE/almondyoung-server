// apps/notification/src/provider/providers/push/fcm.provider.ts
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import {
    NotificationProvider,
    NotificationMessage,
    NotificationResult,
    BulkNotificationResult,
} from '../../interfaces/notification-provider.interface';
import { StructuredLogger } from '../../../shared/utils/logger.utils';

interface FCMConfig {
    projectId: string;
    privateKeyId: string;
    privateKey: string;
    clientEmail: string;
    clientId: string;
}

interface FCMMessage {
    token: string;
    notification?: {
        title?: string;
        body?: string;
        imageUrl?: string;
    };
    data?: { [key: string]: string };
    android?: admin.messaging.AndroidConfig;
    apns?: admin.messaging.ApnsConfig;
    webpush?: admin.messaging.WebpushConfig;
}

export class FCMProvider implements NotificationProvider {
    private readonly logger: StructuredLogger;
    private readonly providerId: string;
    private readonly config: FCMConfig;
    private messaging: admin.messaging.Messaging;
    private isInitialized: boolean = false;

    constructor(
        providerId: string,
        config: Record<string, any>,
        private readonly configService: ConfigService,
    ) {
        this.logger = new StructuredLogger(new Logger(FCMProvider.name));
        this.providerId = providerId;

        // DB config 우선, 없으면 환경변수
        this.config = {
            projectId: config.projectId || this.configService.get<string>('FIREBASE_PROJECT_ID')!,
            privateKeyId: config.privateKeyId || this.configService.get<string>('FIREBASE_PRIVATE_KEY_ID')!,
            privateKey: config.privateKey || this.configService.get<string>('FIREBASE_PRIVATE_KEY')!,
            clientEmail: config.clientEmail || this.configService.get<string>('FIREBASE_CLIENT_EMAIL')!,
            clientId: config.clientId || this.configService.get<string>('FIREBASE_CLIENT_ID')!,
        };

        // 필수 설정값 검증
        if (!this.config.projectId) {
            throw new Error('FIREBASE_PROJECT_ID is required');
        }
        if (!this.config.privateKey) {
            throw new Error('FIREBASE_PRIVATE_KEY is required');
        }
        if (!this.config.clientEmail) {
            throw new Error('FIREBASE_CLIENT_EMAIL is required');
        }

        this.initializeFirebase();
    }

    private initializeFirebase() {
        try {
            const appName = `fcm-provider-${this.providerId}`;

            // 이미 초기화된 앱이 있는지 확인
            let app = admin.apps.find(a => a?.name === appName);

            if (!app) {
                // Firebase Admin 초기화
                app = admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: this.config.projectId,
                        privateKey: this.config.privateKey.replace(/\\n/g, '\n'),
                        clientEmail: this.config.clientEmail,
                    }),
                    projectId: this.config.projectId,
                }, appName);
            }

            this.messaging = app.messaging();
            this.isInitialized = true;

            this.logger.log('FCM Provider initialized', {
                providerId: this.providerId,
                projectId: this.config.projectId,
                reused: admin.apps.length > 1,
            });
        } catch (error: any) {
            this.logger.error('Failed to initialize FCM', {
                error: error.message,
            }, error.stack);
            throw error;
        }
    }

    getName(): string {
        return 'FCM Push';
    }

    getProviderId(): string {
        return this.providerId;
    }

    async isAvailable(): Promise<boolean> {
        return this.isInitialized;
    }

    async send(message: NotificationMessage): Promise<NotificationResult> {
        if (!this.isInitialized) {
            return {
                success: false,
                error: 'FCM provider not initialized',
            };
        }

        try {
            const metadata = message.metadata || {};

            // FCM 메시지 구성
            const fcmMessage: FCMMessage = {
                token: message.to,
                notification: {
                    title: message.subject || metadata.title,
                    body: message.content,
                    imageUrl: metadata.imageUrl,
                },
                data: this.buildDataPayload(metadata),
            };

            // 플랫폼별 설정
            if (metadata.android) {
                fcmMessage.android = this.buildAndroidConfig(metadata.android);
            }

            if (metadata.apns) {
                fcmMessage.apns = this.buildApnsConfig(metadata.apns);
            }

            if (metadata.webpush) {
                fcmMessage.webpush = this.buildWebpushConfig(metadata.webpush);
            }

            // 메시지 전송
            const messageId = await this.messaging.send(fcmMessage as any);

            this.logger.log('FCM message sent successfully', {
                messageId,
                to: message.to,
            });

            return {
                success: true,
                messageId,
            };
        } catch (error: any) {
            return this.handleError(error, message.to);
        }
    }

    async sendBulk(messages: NotificationMessage[]): Promise<BulkNotificationResult> {
        if (!this.isInitialized) {
            return {
                successCount: 0,
                failureCount: messages.length,
                failures: messages.map(m => ({
                    to: m.to,
                    error: 'FCM provider not initialized',
                })),
            };
        }

        const results: NotificationResult[] = [];
        const failures: Array<{ to: string; error: string }> = [];
        let successCount = 0;
        let failureCount = 0;

        // FCM은 한 번에 최대 500개까지 전송 가능
        const BATCH_SIZE = 500;

        for (let i = 0; i < messages.length; i += BATCH_SIZE) {
            const batch = messages.slice(i, i + BATCH_SIZE);

            try {
                // 멀티캐스트 메시지 구성
                const fcmMessages: admin.messaging.Message[] = batch.map(message => {
                    const metadata = message.metadata || {};

                    return {
                        token: message.to,
                        notification: {
                            title: message.subject || metadata.title,
                            body: message.content,
                            imageUrl: metadata.imageUrl,
                        },
                        data: this.buildDataPayload(metadata),
                        android: metadata.android ? this.buildAndroidConfig(metadata.android) : undefined,
                        apns: metadata.apns ? this.buildApnsConfig(metadata.apns) : undefined,
                        webpush: metadata.webpush ? this.buildWebpushConfig(metadata.webpush) : undefined,
                    };
                });

                // 배치 전송
                const response = await this.messaging.sendEach(fcmMessages);

                // 결과 처리
                response.responses.forEach((resp, index) => {
                    if (resp.success) {
                        successCount++;
                        results.push({
                            success: true,
                            messageId: resp.messageId,
                        });
                    } else {
                        failureCount++;
                        const error = resp.error;
                        failures.push({
                            to: batch[index].to,
                            error: error?.message || 'Unknown error',
                        });

                        this.logger.warn('Failed to send FCM message', {
                            to: batch[index].to,
                            error: error?.message,
                            code: error?.code,
                        });
                    }
                });

            } catch (error: any) {
                this.logger.error('Batch send failed', {
                    batchIndex: i / BATCH_SIZE,
                    error: error.message,
                });

                // 배치 전체 실패 처리
                batch.forEach(message => {
                    failureCount++;
                    failures.push({
                        to: message.to,
                        error: error.message,
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

    private buildDataPayload(metadata: any): { [key: string]: string } {
        const data: { [key: string]: string } = {};

        // 모든 메타데이터를 문자열로 변환하여 data payload에 포함
        if (metadata.notificationId) {
            data.notificationId = metadata.notificationId;
        }
        if (metadata.campaignId) {
            data.campaignId = metadata.campaignId;
        }
        if (metadata.category) {
            data.category = metadata.category;
        }
        if (metadata.priority) {
            data.priority = metadata.priority;
        }
        if (metadata.clickAction) {
            data.clickAction = metadata.clickAction;
        }
        if (metadata.sound) {
            data.sound = metadata.sound;
        }

        // 커스텀 데이터 추가
        if (metadata.customData) {
            Object.entries(metadata.customData).forEach(([key, value]) => {
                if (typeof value === 'string') {
                    data[key] = value;
                } else {
                    data[key] = JSON.stringify(value);
                }
            });
        }

        return data;
    }

    private buildAndroidConfig(androidConfig: any): admin.messaging.AndroidConfig {
        const n = androidConfig?.notification ?? {};

        const vibrateTimingsMillis: number[] | undefined = Array.isArray(n.vibrateTimings)
            ? n.vibrateTimings
                .map((v: any) => {
                    if (typeof v === 'number') return v;
                    if (typeof v !== 'string') return undefined;
                    const s = v.trim().toLowerCase();
                    if (s.endsWith('ms')) return Number(s.replace('ms', '').trim());
                    if (s.endsWith('s')) return Math.round(Number(s.replace('s', '').trim()) * 1000);
                    const num = Number(s);
                    return Number.isFinite(num) ? num : undefined;
                })
                .filter((x: any) => Number.isFinite(x)) as number[]
            : undefined;

        const notification: admin.messaging.AndroidNotification | undefined = n
            ? {
                title: n.title,
                body: n.body,
                icon: n.icon,
                color: n.color,
                sound: n.sound,
                tag: n.tag,
                clickAction: n.clickAction,
                bodyLocKey: n.bodyLocKey,
                bodyLocArgs: n.bodyLocArgs,
                titleLocKey: n.titleLocKey,
                titleLocArgs: n.titleLocArgs,
                channelId: n.channelId,
                ticker: n.ticker,
                sticky: n.sticky,
                localOnly: n.localOnly,
                defaultSound: n.defaultSound,
                defaultVibrateTimings: n.defaultVibrateTimings,
                defaultLightSettings: n.defaultLightSettings,
                visibility: n.visibility,
                notificationCount: n.notificationCount,
                lightSettings: n.lightSettings,
                imageUrl: n.imageUrl ?? n.image,
                vibrateTimingsMillis: vibrateTimingsMillis,
            }
            : undefined;

        return {
            priority: androidConfig.priority || 'high',
            ttl: androidConfig.ttl ? parseInt(androidConfig.ttl, 10) * 1000 : undefined,
            notification,
            data: androidConfig.data,
            restrictedPackageName: androidConfig.restrictedPackageName,
            collapseKey: androidConfig.collapseKey,
        };
    }


    private buildApnsConfig(apnsConfig: any): admin.messaging.ApnsConfig {
        return {
            headers: apnsConfig.headers,
            payload: {
                aps: {
                    alert: apnsConfig.alert ? {
                        title: apnsConfig.alert.title,
                        subtitle: apnsConfig.alert.subtitle,
                        body: apnsConfig.alert.body,
                        locKey: apnsConfig.alert.locKey,
                        locArgs: apnsConfig.alert.locArgs,
                        titleLocKey: apnsConfig.alert.titleLocKey,
                        titleLocArgs: apnsConfig.alert.titleLocArgs,
                        subtitleLocKey: apnsConfig.alert.subtitleLocKey,
                        subtitleLocArgs: apnsConfig.alert.subtitleLocArgs,
                        actionLocKey: apnsConfig.alert.actionLocKey,
                        launchImage: apnsConfig.alert.launchImage,
                    } : apnsConfig.alert,
                    badge: apnsConfig.badge,
                    sound: apnsConfig.sound,
                    contentAvailable: apnsConfig.contentAvailable,
                    category: apnsConfig.category,
                    threadId: apnsConfig.threadId,
                    mutableContent: apnsConfig.mutableContent,
                },
                ...apnsConfig.customData,
            },
            fcmOptions: apnsConfig.fcmOptions,
        };
    }

    private buildWebpushConfig(webpushConfig: any): admin.messaging.WebpushConfig {
        return {
            headers: webpushConfig.headers,
            data: webpushConfig.data,
            notification: webpushConfig.notification ? {
                title: webpushConfig.notification.title,
                body: webpushConfig.notification.body,
                icon: webpushConfig.notification.icon,
                badge: webpushConfig.notification.badge,
                image: webpushConfig.notification.image,
                data: webpushConfig.notification.data,
                dir: webpushConfig.notification.dir,
                lang: webpushConfig.notification.lang,
                tag: webpushConfig.notification.tag,
                renotify: webpushConfig.notification.renotify,
                requireInteraction: webpushConfig.notification.requireInteraction,
                silent: webpushConfig.notification.silent,
                timestamp: webpushConfig.notification.timestamp,
                vibrate: webpushConfig.notification.vibrate,
                actions: webpushConfig.notification.actions,
            } : undefined,
            fcmOptions: webpushConfig.fcmOptions,
        };
    }

    private handleError(error: any, to: string): NotificationResult {
        this.logger.error('Failed to send FCM message', {
            to,
            error: error.message,
            code: error.code,
        });

        let errorMessage = error.message || 'Unknown error';

        // FCM 에러 코드 매핑
        if (error.code) {
            switch (error.code) {
                case 'messaging/invalid-registration-token':
                case 'messaging/registration-token-not-registered':
                    errorMessage = 'Invalid or unregistered token';
                    break;
                case 'messaging/invalid-argument':
                    errorMessage = 'Invalid message format';
                    break;
                case 'messaging/message-rate-exceeded':
                    errorMessage = 'Message rate exceeded';
                    break;
                case 'messaging/device-message-rate-exceeded':
                    errorMessage = 'Device message rate exceeded';
                    break;
                case 'messaging/topics-message-rate-exceeded':
                    errorMessage = 'Topics message rate exceeded';
                    break;
                case 'messaging/too-many-topics':
                    errorMessage = 'Too many topics';
                    break;
                case 'messaging/invalid-apns-credentials':
                    errorMessage = 'Invalid APNS credentials';
                    break;
                case 'messaging/mismatched-credential':
                    errorMessage = 'Mismatched credential';
                    break;
                case 'messaging/authentication-error':
                    errorMessage = 'Authentication error';
                    break;
                case 'messaging/server-unavailable':
                    errorMessage = 'FCM server unavailable';
                    break;
                case 'messaging/internal-error':
                    errorMessage = 'Internal server error';
                    break;
            }
        }

        return {
            success: false,
            error: errorMessage,
            providerResponse: {
                code: error.code,
                message: error.message,
            },
        };
    }

    // 주제 구독 관리 메서드
    async subscribeToTopic(tokens: string[], topic: string): Promise<admin.messaging.MessagingTopicManagementResponse> {
        if (!this.isInitialized) {
            throw new Error('FCM provider not initialized');
        }

        try {
            const response = await this.messaging.subscribeToTopic(tokens, topic);

            this.logger.log('Subscribed to topic', {
                topic,
                successCount: response.successCount,
                failureCount: response.failureCount,
            });

            return response;
        } catch (error: any) {
            this.logger.error('Failed to subscribe to topic', {
                topic,
                error: error.message,
            });
            throw error;
        }
    }

    async unsubscribeFromTopic(tokens: string[], topic: string): Promise<admin.messaging.MessagingTopicManagementResponse> {
        if (!this.isInitialized) {
            throw new Error('FCM provider not initialized');
        }

        try {
            const response = await this.messaging.unsubscribeFromTopic(tokens, topic);

            this.logger.log('Unsubscribed from topic', {
                topic,
                successCount: response.successCount,
                failureCount: response.failureCount,
            });

            return response;
        } catch (error: any) {
            this.logger.error('Failed to unsubscribe from topic', {
                topic,
                error: error.message,
            });
            throw error;
        }
    }

    // 주제로 메시지 전송
    async sendToTopic(topic: string, message: NotificationMessage): Promise<NotificationResult> {
        if (!this.isInitialized) {
            return {
                success: false,
                error: 'FCM provider not initialized',
            };
        }

        try {
            const metadata = message.metadata || {};

            const fcmMessage: admin.messaging.Message = {
                topic,
                notification: {
                    title: message.subject || metadata.title,
                    body: message.content,
                    imageUrl: metadata.imageUrl,
                },
                data: this.buildDataPayload(metadata),
                android: metadata.android ? this.buildAndroidConfig(metadata.android) : undefined,
                apns: metadata.apns ? this.buildApnsConfig(metadata.apns) : undefined,
                webpush: metadata.webpush ? this.buildWebpushConfig(metadata.webpush) : undefined,
            };

            const messageId = await this.messaging.send(fcmMessage);

            this.logger.log('FCM topic message sent successfully', {
                messageId,
                topic,
            });

            return {
                success: true,
                messageId,
            };
        } catch (error: any) {
            return this.handleError(error, `topic:${topic}`);
        }
    }

    // 조건으로 메시지 전송
    async sendToCondition(condition: string, message: NotificationMessage): Promise<NotificationResult> {
        if (!this.isInitialized) {
            return {
                success: false,
                error: 'FCM provider not initialized',
            };
        }

        try {
            const metadata = message.metadata || {};

            const fcmMessage: admin.messaging.Message = {
                condition,
                notification: {
                    title: message.subject || metadata.title,
                    body: message.content,
                    imageUrl: metadata.imageUrl,
                },
                data: this.buildDataPayload(metadata),
                android: metadata.android ? this.buildAndroidConfig(metadata.android) : undefined,
                apns: metadata.apns ? this.buildApnsConfig(metadata.apns) : undefined,
                webpush: metadata.webpush ? this.buildWebpushConfig(metadata.webpush) : undefined,
            };

            const messageId = await this.messaging.send(fcmMessage);

            this.logger.log('FCM condition message sent successfully', {
                messageId,
                condition,
            });

            return {
                success: true,
                messageId,
            };
        } catch (error: any) {
            return this.handleError(error, `condition:${condition}`);
        }
    }
}
