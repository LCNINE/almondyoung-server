import { DbService, InjectDb } from '@app/db';
import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import webpush from 'web-push';
import {
  type NotificationSchema,
  webPushDeliveries,
  webPushSubscriptions,
} from '../../../database/schemas/notification-schema';
import { BrowserSubscriptionDto, SendBrowserPushDto } from '../dto/web-push.dto';
import { safeAttendanceUrl, validateSubscription } from './web-push-policy';

@Injectable()
export class WebPushService {
  constructor(@InjectDb() private readonly database: DbService<NotificationSchema>) {}

  config() {
    const configured = !!(
      process.env.WEB_PUSH_PUBLIC_KEY &&
      process.env.WEB_PUSH_PRIVATE_KEY &&
      process.env.WEB_PUSH_SUBJECT
    );

    return { configured, publicKey: configured ? process.env.WEB_PUSH_PUBLIC_KEY : null };
  }

  async register(userId: string, input: BrowserSubscriptionDto) {
    validateSubscription(input);

    if (!this.config().configured) {
      throw new ServiceUnavailableException('알림을 아직 준비 중이에요.');
    }

    const changed = await this.database.db
      .insert(webPushSubscriptions)
      .values({ userId, ...input })
      .onConflictDoUpdate({
        target: webPushSubscriptions.endpoint,
        set: { keys: input.keys, active: true, updatedAt: new Date() },
        setWhere: eq(webPushSubscriptions.userId, userId),
      })
      .returning({ id: webPushSubscriptions.id });

    if (!changed.length) {
      throw new ConflictException('이 기기의 이전 계정 알림을 해제한 뒤 다시 연결해 주세요.');
    }

    return { success: true };
  }

  async remove(userId: string, endpoint: string) {
    await this.database.db
      .update(webPushSubscriptions)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(webPushSubscriptions.userId, userId), eq(webPushSubscriptions.endpoint, endpoint)));

    return { success: true };
  }

  async send(input: SendBrowserPushDto) {
    safeAttendanceUrl(input.url);

    if (!this.config().configured) {
      throw new ServiceUnavailableException('Web Push is not configured');
    }

    const subscriptions = await this.database.db
      .select()
      .from(webPushSubscriptions)
      .where(and(eq(webPushSubscriptions.userId, input.userId), eq(webPushSubscriptions.active, true)));

    const topic = createHash('sha256').update(input.key).digest('base64url').slice(0, 32);

    for (const subscription of subscriptions) {
      validateSubscription(subscription);

      await this.database.db
        .insert(webPushDeliveries)
        .values({ key: input.key, subscriptionId: subscription.id })
        .onConflictDoNothing();

      await this.database.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(webPushSubscriptions)
          .where(eq(webPushSubscriptions.id, subscription.id))
          .for('share');

        if (!current.active || current.userId !== input.userId) {
          return;
        }

        const [delivery] = await tx
          .select()
          .from(webPushDeliveries)
          .where(and(eq(webPushDeliveries.key, input.key), eq(webPushDeliveries.subscriptionId, subscription.id)))
          .for('update');

        if (delivery.status === 'sent' || delivery.status === 'expired') {
          return;
        }

        try {
          await webpush.sendNotification(
            { endpoint: current.endpoint, keys: current.keys },
            JSON.stringify({ title: input.title, body: input.body, url: input.url, tag: topic, userId: input.userId }),
            {
              TTL: 300,
              timeout: 10000,
              topic,
              vapidDetails: {
                subject: process.env.WEB_PUSH_SUBJECT!,
                publicKey: process.env.WEB_PUSH_PUBLIC_KEY!,
                privateKey: process.env.WEB_PUSH_PRIVATE_KEY!,
              },
            },
          );

          await tx
            .update(webPushDeliveries)
            .set({ status: 'sent', sentAt: new Date() })
            .where(eq(webPushDeliveries.id, delivery.id));
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;

          if (status !== 404 && status !== 410) {
            throw error;
          }

          await tx
            .update(webPushSubscriptions)
            .set({ active: false })
            .where(eq(webPushSubscriptions.id, subscription.id));

          await tx.update(webPushDeliveries).set({ status: 'expired' }).where(eq(webPushDeliveries.id, delivery.id));
        }
      });
    }

    return { success: true };
  }
}
