import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { and, asc, count, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  NewNotification,
  NewSmsDevice,
  Notification,
  notifications,
  notificationTables,
  SmsDevice,
  smsDevices,
} from '../../database/schemas/notification-schema';
import { SMS_GATE_PROVIDER_ID } from './sms-gate.constants';

type Schema = typeof notificationTables;

const isSmsGate = eq(notifications.providerId, SMS_GATE_PROVIDER_ID);

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

  async countSentSince(since: Date): Promise<Map<string, number>> {
    const rows = await this.dbService.db
      .select({ deviceId: notifications.smsDeviceId, sent: count() })
      .from(notifications)
      .where(and(isSmsGate, eq(notifications.status, 'SENT'), gte(notifications.sentAt, since)))
      .groupBy(notifications.smsDeviceId);
    return new Map(rows.filter((r) => r.deviceId !== null).map((r) => [r.deviceId as string, r.sent]));
  }

  async countPending(): Promise<number> {
    const [row] = await this.dbService.db
      .select({ pending: count() })
      .from(notifications)
      .where(and(isSmsGate, eq(notifications.status, 'PENDING')));
    return row?.pending ?? 0;
  }

  async enqueue(rows: NewNotification[]): Promise<Notification[]> {
    if (rows.length === 0) return [];
    return this.dbService.db.insert(notifications).values(rows).returning();
  }

  findDue(now: Date, limit: number): Promise<Notification[]> {
    return this.dbService.db
      .select()
      .from(notifications)
      .where(
        and(
          isSmsGate,
          eq(notifications.status, 'PENDING'),
          or(isNull(notifications.sendAt), lte(notifications.sendAt, now)),
        ),
      )
      .orderBy(asc(notifications.createdAt))
      .limit(limit);
  }

  async claim(row: Notification): Promise<boolean> {
    const claimed = await this.dbService.db
      .update(notifications)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(and(eq(notifications.notificationId, row.notificationId), eq(notifications.status, 'PENDING')))
      .returning({ id: notifications.notificationId });
    return claimed.length === 1;
  }

  async markSent(row: Notification, deviceId: string, externalId: string): Promise<void> {
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

  findMessages(ids: string[]): Promise<Notification[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.dbService.db
      .select()
      .from(notifications)
      .where(and(isSmsGate, inArray(notifications.notificationId, ids)));
  }
}
