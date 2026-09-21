import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, max, ne, or, sql } from 'drizzle-orm';
import {
  InboundMessage,
  inboundMessages,
  NewInboundMessage,
  NewNotification,
  NewNotificationCampaign,
  NewSmsDevice,
  NewSmsTemplate,
  Notification,
  NotificationCampaign,
  notificationCampaigns,
  notifications,
  notificationTables,
  SmsDevice,
  smsDevices,
  SmsTemplate,
  smsTemplates,
} from '../../../database/schemas/notification-schema';
import { SMS_GATE_PROVIDER_ID } from '../constants/sms-gate.constants';

type Schema = typeof notificationTables;

const isSmsGate = eq(notifications.providerId, SMS_GATE_PROVIDER_ID);
const isSmsGateCampaign = sql`${notificationCampaigns.metadata}->>'provider' = 'sms-gate'`;
const INSERT_CHUNK = 1000;

export interface CampaignStatusCount {
  campaignId: string;
  status: Notification['status'];
  count: number;
}

@Injectable()
export class SmsGateRepository {
  constructor(@InjectTypedDb<Schema>() private readonly dbService: DbService<Schema>) {}

  async withDispatchLock(fn: () => Promise<void>): Promise<void> {
    await this.dbService.run(async (tx) => {
      const rows = await tx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext('notification.sms-gate.dispatch')) AS locked`,
      );
      if (rows[0]?.locked === true) await fn();
    });
  }

  listDevices(): Promise<SmsDevice[]> {
    return this.dbService.db.select().from(smsDevices).orderBy(asc(smsDevices.createdAt));
  }

  async findDeviceById(id: string): Promise<SmsDevice | undefined> {
    const [row] = await this.dbService.db.select().from(smsDevices).where(eq(smsDevices.id, id));
    return row;
  }

  async findDeviceByDeviceId(deviceId: string): Promise<SmsDevice | undefined> {
    const [row] = await this.dbService.db.select().from(smsDevices).where(eq(smsDevices.deviceId, deviceId));
    return row;
  }

  async createDevice(values: NewSmsDevice): Promise<SmsDevice> {
    const [row] = await this.dbService.db.insert(smsDevices).values(values).returning();
    return row;
  }

  async updateDevice(id: string, values: Partial<Pick<SmsDevice, 'name' | 'dailyLimit' | 'enabled'>>): Promise<void> {
    await this.dbService.db
      .update(smsDevices)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(smsDevices.id, id));
  }

  async deleteDevice(id: string): Promise<void> {
    await this.dbService.db.delete(smsDevices).where(eq(smsDevices.id, id));
  }

  listTemplates(): Promise<SmsTemplate[]> {
    return this.dbService.db.select().from(smsTemplates).orderBy(desc(smsTemplates.updatedAt));
  }

  async findTemplateById(id: string): Promise<SmsTemplate | undefined> {
    const [row] = await this.dbService.db.select().from(smsTemplates).where(eq(smsTemplates.id, id));
    return row;
  }

  async createTemplate(values: NewSmsTemplate): Promise<SmsTemplate> {
    const [row] = await this.dbService.db.insert(smsTemplates).values(values).returning();
    return row;
  }

  async updateTemplate(id: string, values: Partial<Pick<SmsTemplate, 'name' | 'category' | 'content'>>): Promise<void> {
    await this.dbService.db
      .update(smsTemplates)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(smsTemplates.id, id));
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.dbService.db.delete(smsTemplates).where(eq(smsTemplates.id, id));
  }

  async countSentSince(since: Date): Promise<Map<string, number>> {
    const rows = await this.dbService.db
      .select({ deviceId: notifications.smsDeviceId, sent: count() })
      .from(notifications)
      .where(and(isSmsGate, eq(notifications.status, 'SENT'), gte(notifications.sentAt, since)))
      .groupBy(notifications.smsDeviceId);
    return new Map(rows.filter((r) => r.deviceId !== null).map((r) => [r.deviceId as string, r.sent]));
  }

  async lastSentAtByDevice(): Promise<Map<string, Date>> {
    const rows = await this.dbService.db
      .select({ deviceId: notifications.smsDeviceId, lastSentAt: max(notifications.sentAt) })
      .from(notifications)
      .where(and(isSmsGate, eq(notifications.status, 'SENT'), isNotNull(notifications.smsDeviceId)))
      .groupBy(notifications.smsDeviceId);
    return new Map(
      rows.flatMap((r) => (r.deviceId && r.lastSentAt ? [[r.deviceId, r.lastSentAt] as [string, Date]] : [])),
    );
  }

  async countPending(singlesOnly = false): Promise<number> {
    const [row] = await this.dbService.db
      .select({ pending: count() })
      .from(notifications)
      .where(
        and(isSmsGate, eq(notifications.status, 'PENDING'), singlesOnly ? isNull(notifications.campaignId) : undefined),
      );
    return row?.pending ?? 0;
  }

  async enqueue(rows: NewNotification[]): Promise<Notification[]> {
    if (rows.length === 0) return [];
    return this.dbService.db.insert(notifications).values(rows).returning();
  }

  findDue(now: Date, limit: number, includeMarketing: boolean, bulk: boolean): Promise<Notification[]> {
    return this.dbService.db
      .select()
      .from(notifications)
      .where(
        and(
          isSmsGate,
          eq(notifications.status, 'PENDING'),
          bulk ? isNotNull(notifications.campaignId) : isNull(notifications.campaignId),
          or(isNull(notifications.sendAt), lte(notifications.sendAt, now)),
          includeMarketing ? undefined : ne(notifications.category, 'MARKETING'),
        ),
      )
      .orderBy(asc(notifications.createdAt))
      .limit(limit);
  }

  async createCampaign(campaign: NewNotificationCampaign, rows: NewNotification[]): Promise<void> {
    await this.dbService.run(async (tx) => {
      await tx.insert(notificationCampaigns).values(campaign);
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await tx.insert(notifications).values(rows.slice(i, i + INSERT_CHUNK));
      }
    });
  }

  listCampaigns(limit: number): Promise<NotificationCampaign[]> {
    return this.dbService.db
      .select()
      .from(notificationCampaigns)
      .where(isSmsGateCampaign)
      .orderBy(desc(notificationCampaigns.createdAt))
      .limit(limit);
  }

  async findCampaign(campaignId: string): Promise<NotificationCampaign | undefined> {
    const [row] = await this.dbService.db
      .select()
      .from(notificationCampaigns)
      .where(and(isSmsGateCampaign, eq(notificationCampaigns.campaignId, campaignId)));
    return row;
  }

  async countByCampaign(campaignIds: string[]): Promise<CampaignStatusCount[]> {
    if (campaignIds.length === 0) return [];
    const rows = await this.dbService.db
      .select({ campaignId: notifications.campaignId, status: notifications.status, count: count() })
      .from(notifications)
      .where(and(isSmsGate, inArray(notifications.campaignId, campaignIds)))
      .groupBy(notifications.campaignId, notifications.status);
    return rows.flatMap((r) => (r.campaignId ? [{ campaignId: r.campaignId, status: r.status, count: r.count }] : []));
  }

  async cancelCampaign(campaignId: string): Promise<number> {
    return this.dbService.run(async (tx) => {
      const cancelled = await tx
        .update(notifications)
        .set({ status: 'CANCELLED', errorDetails: { message: '대량 발송을 중지했습니다', timestamp: new Date() }, updatedAt: new Date() })
        .where(and(isSmsGate, eq(notifications.campaignId, campaignId), eq(notifications.status, 'PENDING')))
        .returning({ id: notifications.notificationId });
      await tx
        .update(notificationCampaigns)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(eq(notificationCampaigns.campaignId, campaignId));
      return cancelled.length;
    });
  }

  async claim(row: Notification): Promise<boolean> {
    const claimed = await this.dbService.db
      .update(notifications)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(and(eq(notifications.notificationId, row.notificationId), eq(notifications.status, 'PENDING')))
      .returning({ id: notifications.notificationId });
    return claimed.length === 1;
  }

  async markSent(row: Notification, deviceId: string | null, externalId: string): Promise<void> {
    await this.dbService.db
      .update(notifications)
      .set({
        status: 'SENT',
        smsDeviceId: deviceId,
        sentAt: new Date(),
        attempts: row.attempts + 1,
        metadata: { ...row.metadata, externalId },
        updatedAt: new Date(),
      })
      .where(eq(notifications.notificationId, row.notificationId));
  }

  async markFailed(row: Notification, deviceId: string | null, message: string): Promise<void> {
    await this.dbService.db
      .update(notifications)
      .set({
        status: 'FAILED',
        smsDeviceId: deviceId,
        attempts: row.attempts + 1,
        errorDetails: { message, timestamp: new Date() },
        updatedAt: new Date(),
      })
      .where(eq(notifications.notificationId, row.notificationId));
  }

  async markCancelled(row: Notification, message: string): Promise<void> {
    await this.dbService.db
      .update(notifications)
      .set({ status: 'CANCELLED', errorDetails: { message, timestamp: new Date() }, updatedAt: new Date() })
      .where(and(eq(notifications.notificationId, row.notificationId), eq(notifications.status, 'PENDING')));
  }

  async saveInbound(values: NewInboundMessage): Promise<void> {
    await this.dbService.db.insert(inboundMessages).values(values).onConflictDoNothing();
  }

  async fillInboundUser(phoneNumber: string, userId: string): Promise<void> {
    await this.dbService.db
      .update(inboundMessages)
      .set({ userId })
      .where(and(eq(inboundMessages.phoneNumber, phoneNumber), isNull(inboundMessages.userId)));
  }

  async pageLatestInboundPerPhone(
    page: number,
    limit: number,
    q?: string,
  ): Promise<{ items: InboundMessage[]; total: number }> {
    const keyword = q?.trim();
    const digits = keyword?.replace(/^\+82/, '0').replace(/\D/g, '');
    const matchesKeyword = keyword
      ? or(
          digits ? sql`regexp_replace(${inboundMessages.phoneNumber}, '^[+]82', '0') like ${`%${digits}%`}` : undefined,
          inArray(
            inboundMessages.phoneNumber,
            this.dbService.db
              .selectDistinct({ phoneNumber: inboundMessages.phoneNumber })
              .from(inboundMessages)
              .where(ilike(inboundMessages.body, `%${keyword}%`)),
          ),
        )
      : undefined;

    const latest = this.dbService.db
      .selectDistinctOn([inboundMessages.phoneNumber])
      .from(inboundMessages)
      .where(matchesKeyword)
      .orderBy(inboundMessages.phoneNumber, desc(inboundMessages.receivedAt), desc(inboundMessages.createdAt))
      .as('latest');

    const [items, [totalRow]] = await Promise.all([
      this.dbService.db
        .select()
        .from(latest)
        .orderBy(desc(latest.receivedAt), asc(latest.phoneNumber))
        .limit(limit)
        .offset((page - 1) * limit),
      this.dbService.db
        .select({ total: sql<number>`count(distinct ${inboundMessages.phoneNumber})`.mapWith(Number) })
        .from(inboundMessages)
        .where(matchesKeyword),
    ]);
    return { items, total: totalRow?.total ?? 0 };
  }

  findInbound(phoneNumber: string): Promise<InboundMessage[]> {
    return this.dbService.db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.phoneNumber, phoneNumber))
      .orderBy(asc(inboundMessages.receivedAt));
  }

  findPhoneMessagesTo(phoneNumberE164: string, limit: number): Promise<Notification[]> {
    const digits = phoneNumberE164.replace(/\D/g, '');
    const variants = digits.startsWith('82') ? [digits, `0${digits.slice(2)}`] : [digits];
    return this.dbService.db
      .select()
      .from(notifications)
      .where(
        and(
          inArray(sql`regexp_replace(${notifications.payload}->>'phoneNumber', '[^0-9]', '', 'g')`, variants),
          or(isSmsGate, sql`${notifications.metadata}->>'route' = 'nhn'`),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async hasReplyFor(inboundMessageId: string): Promise<boolean> {
    const [row] = await this.dbService.db
      .select({ id: notifications.notificationId })
      .from(notifications)
      .where(and(isSmsGate, sql`${notifications.metadata}->>'inboundMessageId' = ${inboundMessageId}`))
      .limit(1);
    return !!row;
  }

  findMessages(ids: string[]): Promise<Notification[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.dbService.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.channel, 'SMS'), inArray(notifications.notificationId, ids)));
  }
}
