// apps/notification/src/shared/services/webhook.service.ts
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Webhook } from 'svix';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, and, sql } from 'drizzle-orm';
import {
    receipts,
    notificationLogs,
    notifications,
    userProfiles,
    userNotificationSettings,
} from '../../../database/schemas/notification-schema';
import { ResendWebhookData, ResendWebhookEvent } from '../../provider/providers/email/resend-webhook.dto';
import { AlertService } from './alert.service';
import { NotificationStatus } from '../enums';
import { StructuredLogger } from '../utils/logger.utils';

@Injectable()
export class WebhookService {
    private readonly logger: StructuredLogger;
    private readonly resendWebhook: Webhook;

    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        private readonly configService: ConfigService,
        private readonly alertService: AlertService,
    ) {
        this.logger = new StructuredLogger(new Logger(WebhookService.name));

        // Resend webhook verifier 초기화
        const resendSecret = this.configService.get<string>('RESEND_WEBHOOK_SECRET');
        if (!resendSecret) {
            throw new Error('RESEND_WEBHOOK_SECRET 환경변수가 설정되어 있지 않습니다.');
        }
        this.resendWebhook = new Webhook(resendSecret);
    }

    private get db() {
        return this.dbService.db;
    }

    /**
     * Resend 웹훅 검증 및 처리
     */
    async handleResendWebhook(
        payload: string | ResendWebhookEvent,
        headers: {
            'svix-id': string;
            'svix-timestamp': string;
            'svix-signature': string;
        }
    ): Promise<void> {
        try {
            // 1. 서명 검증
            let event: ResendWebhookEvent;

            if (typeof payload === 'string') {
                // Raw body로 검증
                event = this.resendWebhook.verify(payload, headers) as ResendWebhookEvent;
            } else {
                // 이미 파싱된 경우 (개발 환경)
                if (process.env.NODE_ENV === 'production') {
                    // 프로덕션에서는 반드시 raw body로 검증
                    throw new UnauthorizedException('Invalid webhook payload format');
                }
                event = payload;
            }

            this.logger.log('Resend webhook received', {
                type: event.type,
                emailId: event.data.email_id,
                to: event.data.to,
            });

            // 2. 이벤트 타입별 처리
            await this.processResendEvent(event);

        } catch (error: any) {
            this.logger.error('Failed to process Resend webhook', {
                error: error.message,
            }, error.stack);

            // 서명 검증 실패는 재시도하지 않음
            if (error instanceof UnauthorizedException) {
                throw error;
            }

            // 다른 에러는 재시도를 위해 500 에러 반환
            throw new Error(`Webhook processing failed: ${error.message}`);
        }
    }

    private async processResendEvent(event: ResendWebhookEvent): Promise<void> {
        const { type, data } = event;
        const emailId = data.email_id;
        const tags = data.tags || {};

        // 태그에서 메타데이터 추출
        const notificationId = tags.notification_id;
        const userId = tags.user_id;
        const campaignId = tags.campaign_id;

        switch (type) {
            case 'email.sent':
                await this.handleEmailSent(emailId, notificationId, data);
                break;

            case 'email.delivered':
                await this.handleEmailDelivered(emailId, notificationId, data);
                break;

            case 'email.bounced':
                await this.handleEmailBounced(emailId, userId, data);
                break;

            case 'email.complained':
                await this.handleEmailComplained(emailId, userId, data);
                break;

            case 'email.opened':
                await this.handleEmailOpened(emailId, campaignId, data);
                break;

            case 'email.clicked':
                await this.handleEmailClicked(emailId, campaignId, data);
                break;

            case 'email.failed':
                await this.handleEmailFailed(emailId, notificationId, data);
                break;

            case 'email.delivery_delayed':
                await this.handleEmailDelayed(emailId, notificationId, data);
                break;

            default:
                this.logger.warn('Unknown webhook event type', { type });
        }

        // Receipt 저장 (감사 로그)
        await this.saveReceipt(event);
    }

    private async handleEmailSent(
        emailId: string,
        notificationId: string | undefined,
        data: ResendWebhookData
    ): Promise<void> {
        if (notificationId) {
            await this.db
                .update(notifications)
                .set({
                    status: NotificationStatus.SENT,
                    sentAt: new Date(data.created_at),
                    updatedAt: new Date(),
                })
                .where(eq(notifications.notificationId, notificationId));
        }

        this.logger.log('Email sent', { emailId, notificationId });
    }

    private async handleEmailDelivered(
        emailId: string,
        notificationId: string | undefined,
        data: ResendWebhookData
    ): Promise<void> {
        if (notificationId) {
            await this.db
                .update(notifications)
                .set({
                    status: NotificationStatus.DELIVERED,
                    updatedAt: new Date(),
                })
                .where(eq(notifications.notificationId, notificationId));
        }

        this.logger.log('Email delivered', { emailId, notificationId });
    }

    private async handleEmailBounced(
        emailId: string,
        userId: string | undefined,
        data: ResendWebhookData
    ): Promise<void> {
        const bounceInfo = data.bounce;
        const recipientEmail = data.to[0]; // 첫 번째 수신자

        this.logger.warn('Email bounced', {
            emailId,
            recipientEmail,
            bounceType: bounceInfo?.type,
            bounceMessage: bounceInfo?.message,
        });

        // Permanent bounce인 경우 해당 이메일 비활성화
        if (bounceInfo?.type === 'Permanent') {
            // 이메일 주소로 사용자 찾기
            const user = await this.db.query.userProfiles.findFirst({
                where: eq(userProfiles.email, recipientEmail),
            });

            if (user) {
                // 사용자 이메일 무효화 (null로 설정)
                await this.db
                    .update(userProfiles)
                    .set({
                        email: null,
                        metadata: sql`
                            COALESCE(metadata, '{}'::jsonb) || 
                            jsonb_build_object(
                                'email_bounced', true,
                                'bounce_date', ${new Date().toISOString()},
                                'bounce_reason', ${bounceInfo.message}
                            )
                        `,
                        syncedAt: new Date(),
                    })
                    .where(eq(userProfiles.userId, user.userId));

                // 운영 알림 생성
                await this.alertService.createAlert({
                    type: 'email_permanent_bounce',
                    severity: 'medium',
                    title: 'Permanent email bounce detected',
                    message: `Email ${recipientEmail} has been marked as invalid due to permanent bounce`,
                    context: {
                        userId: user.userId,
                        email: recipientEmail,
                        bounceMessage: bounceInfo.message,
                    },
                });
            }
        }
    }

    private async handleEmailComplained(
        emailId: string,
        userId: string | undefined,
        data: ResendWebhookData
    ): Promise<void> {
        const recipientEmail = data.to[0];

        this.logger.warn('Email complaint received', {
            emailId,
            recipientEmail,
        });

        // 스팸 신고한 사용자 수신 거부 처리
        const user = await this.db.query.userProfiles.findFirst({
            where: eq(userProfiles.email, recipientEmail),
        });

        if (user) {
            // 알림 수신 거부 처리
            await this.db
                .update(userNotificationSettings)
                .set({
                    isMarketingEnabled: false,
                    settings: sql`
                        COALESCE(settings, '{}'::jsonb) || 
                        jsonb_build_object(
                            'spam_complaint', true,
                            'complaint_date', ${new Date().toISOString()},
                            'complaint_channel', 'EMAIL'
                        )
                    `,
                    updatedAt: new Date(),
                })
                .where(eq(userNotificationSettings.userId, user.userId));

            // 운영 알림 생성
            await this.alertService.createAlert({
                type: 'spam_complaint',
                severity: 'high',
                title: 'Spam complaint received',
                message: `User marked email as spam: ${recipientEmail}`,
                context: {
                    userId: user.userId,
                    email: recipientEmail,
                    emailId,
                },
            });
        }
    }

    private async handleEmailOpened(
        emailId: string,
        campaignId: string | undefined,
        data: ResendWebhookData
    ): Promise<void> {
        // 캠페인 통계 업데이트
        if (campaignId) {
            await this.updateCampaignStats(campaignId, 'opened');
        }

        this.logger.log('Email opened', { emailId, campaignId });
    }

    private async handleEmailClicked(
        emailId: string,
        campaignId: string | undefined,
        data: ResendWebhookData
    ): Promise<void> {
        const clickInfo = data.click;

        // 캠페인 통계 업데이트
        if (campaignId) {
            await this.updateCampaignStats(campaignId, 'clicked');
        }

        this.logger.log('Email link clicked', {
            emailId,
            campaignId,
            link: clickInfo?.link,
            timestamp: clickInfo?.timestamp,
        });
    }

    private async handleEmailFailed(
        emailId: string,
        notificationId: string | undefined,
        data: ResendWebhookData
    ): Promise<void> {
        if (notificationId) {
            await this.db
                .update(notifications)
                .set({
                    status: NotificationStatus.FAILED,
                    errorDetails: {
                        message: 'Email failed to send',
                        timestamp: new Date(),
                    },
                    updatedAt: new Date(),
                })
                .where(eq(notifications.notificationId, notificationId));
        }

        this.logger.error('Email failed', {
            emailId,
            notificationId,
            to: data.to,
        });
    }

    private async handleEmailDelayed(
        emailId: string,
        notificationId: string | undefined,
        data: ResendWebhookData
    ): Promise<void> {
        this.logger.warn('Email delivery delayed', {
            emailId,
            notificationId,
            to: data.to,
        });

        // 지연된 이메일은 특별한 처리 없이 로그만 남김
        // Resend가 자동으로 재시도함
    }

    private async updateCampaignStats(
        campaignId: string,
        statType: 'opened' | 'clicked'
    ): Promise<void> {
        await this.db.execute(sql`
            UPDATE notification_campaigns
            SET 
                stats = jsonb_set(
                    stats,
                    '{${statType}}',
                    (COALESCE((stats->>'${statType}')::int, 0) + 1)::text::jsonb
                ),
                updated_at = NOW()
            WHERE campaign_id = ${campaignId}
        `);
    }

    private async saveReceipt(event: ResendWebhookEvent): Promise<void> {
        const tags = event.data.tags || {};

        await this.db.insert(receipts).values({
            notificationId: tags.notification_id || null,
            campaignId: tags.campaign_id || null,
            provider: 'resend',
            status: event.type,
            providerResponse: event as any,
            latencyMs: null,
            metadata: {
                emailId: event.data.email_id,
                to: event.data.to,
                from: event.data.from,
                subject: event.data.subject,
            },
            timestamp: new Date(event.created_at),
        });
    }

    // Twilio 웹훅 처리 (기존 코드)
    async handleTwilioWebhook(data: any): Promise<void> {
        this.logger.log('Twilio webhook received', { data });
        // TODO: Twilio 웹훅 처리 구현
    }

    // Kakao 웹훅 처리 (기존 코드)
    async handleKakaoWebhook(data: any): Promise<void> {
        this.logger.log('Kakao webhook received', { data });
        // TODO: Kakao 웹훅 처리 구현
    }
}