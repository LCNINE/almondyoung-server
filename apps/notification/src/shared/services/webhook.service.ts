// apps/notification/src/shared/services/webhook.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import {
    receipts,
    notifications,
    NewReceipt,
} from '../../../database/schemas/notification-schema';
import { NotificationStatus } from '../enums';
import { ResendWebhookEvent } from '../../provider/providers/email/resend-webhook.dto';

@Injectable()
export class WebhookService {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        private readonly configService: ConfigService,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async handleResendWebhook(event: ResendWebhookEvent): Promise<void> {
        // tags에서 notificationId 추출
        const notificationId = event.data.tags?.find(tag => tag.name === 'notificationId')?.value;
        if (!notificationId) return;

        const receipt: NewReceipt = {
            notificationId,
            provider: 'resend',
            status: this.mapResendStatus(event.type),
            providerResponse: event,
            latencyMs: event.created_at
                ? new Date().getTime() - new Date(event.created_at).getTime()
                : null,
            metadata: {
                emailId: event.data.id,
                eventType: event.type,
            },
        };

        await this.db.insert(receipts).values(receipt);

        // 상태 업데이트
        if (['email.delivered', 'email.bounced'].includes(event.type)) {
            await this.updateNotificationStatus(
                notificationId,
                event.type === 'email.delivered'
                    ? NotificationStatus.DELIVERED
                    : NotificationStatus.FAILED
            );
        }
    }

    async handleTwilioWebhook(data: any): Promise<void> {
        // Twilio Status Callback 처리
        // custom parameter로 전달된 notificationId 확인
        const notificationId = data.custom_notificationId || data.notificationId;
        if (!notificationId) return;

        const receipt: NewReceipt = {
            notificationId,
            provider: 'twilio',
            status: this.mapTwilioStatus(data.MessageStatus || data.SmsStatus),
            providerResponse: data,
            metadata: {
                messageSid: data.MessageSid || data.SmsSid,
                status: data.MessageStatus || data.SmsStatus,
                errorCode: data.ErrorCode,
            },
        };

        await this.db.insert(receipts).values(receipt);

        if (['delivered', 'failed', 'undelivered'].includes(data.MessageStatus || data.SmsStatus)) {
            await this.updateNotificationStatus(
                notificationId,
                (data.MessageStatus || data.SmsStatus) === 'delivered'
                    ? NotificationStatus.DELIVERED
                    : NotificationStatus.FAILED
            );
        }
    }

    async handleKakaoWebhook(data: any): Promise<void> {
        const receipt: NewReceipt = {
            notificationId: data.notificationId,
            provider: 'kakao',
            status: data.status,
            providerResponse: data,
            metadata: {
                requestId: data.requestId,
            },
        };

        await this.db.insert(receipts).values(receipt);
    }

    private async updateNotificationStatus(
        notificationId: string,
        status: NotificationStatus
    ) {
        await this.db
            .update(notifications)
            .set({
                status,
                updatedAt: new Date(),
            })
            .where(eq(notifications.notificationId, notificationId));
    }

    private mapResendStatus(eventType: string): string {
        const statusMap: Record<string, string> = {
            'email.sent': 'sent',
            'email.delivered': 'delivered',
            'email.delivery_delayed': 'delayed',
            'email.bounced': 'bounced',
            'email.opened': 'opened',
            'email.clicked': 'clicked',
            'email.complained': 'complained',
        };
        return statusMap[eventType] || eventType;
    }

    private mapTwilioStatus(status: string): string {
        const statusMap: Record<string, string> = {
            'queued': 'queued',
            'sent': 'sent',
            'delivered': 'delivered',
            'failed': 'failed',
            'undelivered': 'undelivered',
            'receiving': 'receiving',
            'received': 'received',
        };
        return statusMap[status] || status;
    }
}
