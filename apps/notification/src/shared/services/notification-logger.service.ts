// apps/notification/src/shared/services/notification-logger.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import {
    notificationLogs,
    NewNotificationLog,
} from '../../../database/schemas/notification-schema';
import { sql, between, and, eq, desc, or, like, inArray } from 'drizzle-orm';

@Injectable()
export class NotificationLoggerService {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async logNotification(data: {
        notificationId?: string;
        campaignId?: string;
        userId?: string;
        eventKey?: string;
        channel: string;
        provider: string;
        status: string;
        request: any;
        response?: any;
        latencyMs?: number;
        metadata?: any;
    }): Promise<void> {
        const log: NewNotificationLog = {
            notificationId: data.notificationId,
            campaignId: data.campaignId,
            userId: data.userId,
            eventKey: data.eventKey,
            channel: data.channel as any,
            provider: data.provider,
            status: data.status as any,
            request: data.request,
            response: data.response,
            latencyMs: data.latencyMs,
            metadata: data.metadata,
        };

        await this.db.insert(notificationLogs).values(log);
    }

    async getStats(params: {
        startDate?: Date;
        endDate?: Date;
        userId?: string;
        channel?: string;
    }) {
        const conditions: any[] = [];

        if (params.startDate && params.endDate) {
            conditions.push(between(notificationLogs.createdAt, params.startDate, params.endDate));
        }
        if (params.userId) {
            conditions.push(eq(notificationLogs.userId, params.userId));
        }
        if (params.channel) {
            conditions.push(eq(notificationLogs.channel, params.channel as any));
        }

        const query = this.db
            .select({
                channel: notificationLogs.channel,
                status: notificationLogs.status,
                count: sql<number>`count(*)::int`,
                avgLatency: sql<number>`avg(${notificationLogs.latencyMs})::float`,
                minCreatedAt: sql<Date>`min(${notificationLogs.createdAt})`,
                maxCreatedAt: sql<Date>`max(${notificationLogs.createdAt})`,
            })
            .from(notificationLogs);

        if (conditions.length > 0) {
            query.where(and(...conditions));
        }

        return query.groupBy(notificationLogs.channel, notificationLogs.status);
    }

    async findAllLogs(filters?: {
        notificationId?: string;
        campaignId?: string;
        userId?: string;
        eventKey?: string;
        channel?: string;
        provider?: string;
        status?: string[];
        startDate?: Date;
        endDate?: Date;
        limit?: number;
        offset?: number;
    }): Promise<{ logs: any[]; total: number }> {
        const conditions: any[] = [];
        const limit = filters?.limit || 100;
        const offset = filters?.offset || 0;

        if (filters?.notificationId) {
            conditions.push(eq(notificationLogs.notificationId, filters.notificationId));
        }
        if (filters?.campaignId) {
            conditions.push(eq(notificationLogs.campaignId, filters.campaignId));
        }
        if (filters?.userId) {
            conditions.push(eq(notificationLogs.userId, filters.userId));
        }
        if (filters?.eventKey) {
            conditions.push(eq(notificationLogs.eventKey, filters.eventKey));
        }
        if (filters?.channel) {
            conditions.push(eq(notificationLogs.channel, filters.channel as any));
        }
        if (filters?.provider) {
            conditions.push(eq(notificationLogs.provider, filters.provider));
        }
        if (filters?.status && filters.status.length > 0) {
            conditions.push(inArray(notificationLogs.status, filters.status as any));
        }
        if (filters?.startDate && filters?.endDate) {
            conditions.push(between(notificationLogs.createdAt, filters.startDate, filters.endDate));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [logs, totalResult] = await Promise.all([
            this.db.query.notificationLogs.findMany({
                where: whereClause,
                orderBy: (logs, { desc }) => [desc(logs.createdAt)],
                limit,
                offset,
            }),
            this.db
                .select({ count: sql<number>`count(*)::int` })
                .from(notificationLogs)
                .where(whereClause),
        ]);

        return {
            logs: logs || [],
            total: totalResult[0]?.count || 0,
        };
    }

    async findLogsByNotificationId(notificationId: string): Promise<any[]> {
        return this.db.query.notificationLogs.findMany({
            where: eq(notificationLogs.notificationId, notificationId),
            orderBy: (logs, { desc }) => [desc(logs.createdAt)],
        });
    }
}