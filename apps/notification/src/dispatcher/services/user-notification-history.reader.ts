import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { notifications, notificationTables, smsDevices } from '../../../database/schemas/notification-schema';
import { SMS_GATE_PROVIDER_ID } from '../../sms-gate/constants/sms-gate.constants';
import { ListUserNotificationsDto } from '../dto/list-user-notifications.dto';

type Schema = typeof notificationTables;

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RANGE_DAYS = 30;

export interface UserNotificationHistoryItem {
  notificationId: string;
  sendType: 'AUTO' | 'MANUAL';
  route: 'NHN' | 'SMS_GATE';
  deviceName: string | null;
  phoneNumber: string | null;
  subject: string | null;
  body: string;
  status: (typeof notifications.$inferSelect)['status'];
  sentAt: Date;
}

export interface UserNotificationHistoryPage {
  items: UserNotificationHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

export function kstDayRange(from: string, to: string): { start: Date; end: Date } {
  const start = new Date(`${from}T00:00:00+09:00`);
  const last = new Date(`${to}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(last.getTime())) {
    throw new BadRequestError('날짜 형식이 올바르지 않습니다');
  }
  if (last < start) throw new BadRequestError('종료일이 시작일보다 앞설 수 없습니다');
  if (last.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new BadRequestError(`한 번에 최대 ${MAX_RANGE_DAYS}일까지만 조회할 수 있습니다`);
  }
  return { start, end: new Date(last.getTime() + DAY_MS) };
}

@Injectable()
export class UserNotificationHistoryReader {
  constructor(@InjectTypedDb<Schema>() private readonly dbService: DbService<Schema>) {}

  async list(userId: string, dto: ListUserNotificationsDto): Promise<UserNotificationHistoryPage> {
    const { start, end } = kstDayRange(dto.from, dto.to);
    const at = sql`coalesce(${notifications.sentAt}, ${notifications.createdAt})`;
    const where = and(
      eq(notifications.userId, userId),
      eq(notifications.channel, dto.channel),
      sql`${at} >= ${start.toISOString()}::timestamp`,
      sql`${at} < ${end.toISOString()}::timestamp`,
    );
    const db = this.dbService.db;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ row: notifications, deviceName: smsDevices.name })
        .from(notifications)
        .leftJoin(smsDevices, eq(smsDevices.deviceId, notifications.smsDeviceId))
        .where(where)
        .orderBy(desc(at))
        .limit(dto.limit)
        .offset((dto.page - 1) * dto.limit),
      db.select({ total: count() }).from(notifications).where(where),
    ]);

    return {
      items: rows.map(({ row, deviceName }) => ({
        notificationId: row.notificationId,
        sendType: row.metadata?.sentBy ? 'MANUAL' : 'AUTO',
        route: row.providerId === SMS_GATE_PROVIDER_ID ? 'SMS_GATE' : 'NHN',
        deviceName: row.providerId === SMS_GATE_PROVIDER_ID ? (deviceName ?? row.smsDeviceId) : null,
        phoneNumber: row.payload?.phoneNumber ?? null,
        subject: row.renderedContent?.subject ?? null,
        body: row.renderedContent?.body ?? '',
        status: row.status,
        sentAt: row.sentAt ?? row.createdAt,
      })),
      total,
      page: dto.page,
      limit: dto.limit,
    };
  }
}
