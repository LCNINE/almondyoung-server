// apps/notification/src/shared/services/metrics.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { sql, between, and, eq } from 'drizzle-orm';
import { notifications, notificationLogs } from '../../../database/schemas/notification-schema';

@Injectable()
export class MetricsService {
  constructor(
    @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getDailyMetrics(date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await this.db
      .select({
        channel: notifications.channel,
        status: notifications.status,
        count: sql<number>`count(*)`,
        avgLatency: sql<number>`avg(${notificationLogs.latencyMs})`,
      })
      .from(notifications)
      .leftJoin(notificationLogs, eq(notifications.notificationId, notificationLogs.notificationId))
      .where(between(notifications.createdAt, startOfDay, endOfDay))
      .groupBy(notifications.channel, notifications.status);

    return result;
  }

  async getChannelPerformance(channel: string, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const performance = await this.db
      .select({
        date: sql<string>`DATE(${notifications.createdAt})`,
        sent: sql<number>`COUNT(CASE WHEN ${notifications.status} = 'SENT' THEN 1 END)`,
        delivered: sql<number>`COUNT(CASE WHEN ${notifications.status} = 'DELIVERED' THEN 1 END)`,
        failed: sql<number>`COUNT(CASE WHEN ${notifications.status} = 'FAILED' THEN 1 END)`,
        avgLatency: sql<number>`AVG(${notificationLogs.latencyMs})`,
      })
      .from(notifications)
      .leftJoin(notificationLogs, eq(notifications.notificationId, notificationLogs.notificationId))
      .where(and(eq(notifications.channel, channel as any), sql`${notifications.createdAt} >= ${startDate}`))
      .groupBy(sql`DATE(${notifications.createdAt})`)
      .orderBy(sql`DATE(${notifications.createdAt})`);

    return performance;
  }

  async getProviderHealth() {
    const recentLogs = await this.db
      .select({
        provider: notificationLogs.provider,
        channel: notificationLogs.channel,
        status: notificationLogs.status,
        count: sql<number>`count(*)`,
        avgLatency: sql<number>`avg(${notificationLogs.latencyMs})`,
        successRate: sql<number>`
          COUNT(CASE WHEN ${notificationLogs.status} IN ('SENT', 'DELIVERED') THEN 1 END) * 100.0 / COUNT(*)
        `,
      })
      .from(notificationLogs)
      .where(sql`${notificationLogs.createdAt} >= NOW() - INTERVAL '1 hour'`)
      .groupBy(notificationLogs.provider, notificationLogs.channel, notificationLogs.status);

    return recentLogs;
  }
}
