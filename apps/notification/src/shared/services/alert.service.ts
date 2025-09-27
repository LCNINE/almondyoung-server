// apps/notification/src/shared/services/alert.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import {
    alerts,
    Alert,
    NewAlert,
} from '../../../database/schemas/notification-schema';

@Injectable()
export class AlertService {
    private readonly logger = new Logger(AlertService.name);

    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async createAlert(data: {
        type: string;
        severity: string;
        title: string;
        message: string;
        context: any;
    }): Promise<Alert> {
        const newAlert: NewAlert = {
            type: data.type,
            severity: data.severity,
            title: data.title,
            message: data.message,
            context: data.context,
        };

        const [alert] = await this.db
            .insert(alerts)
            .values(newAlert)
            .returning();

        // Log critical alerts
        if (data.severity === 'critical') {
            this.logger.error(`CRITICAL ALERT: ${data.title} - ${data.message}`);
        }

        return alert;
    }

    async getUnresolvedAlerts(): Promise<Alert[]> {
        return this.db.query.alerts.findMany({
            where: eq(alerts.isResolved, false),
            orderBy: (alerts, { desc }) => [desc(alerts.createdAt)],
        });
    }

    async resolveAlert(alertId: string, resolvedBy: string): Promise<Alert> {
        const [resolved] = await this.db
            .update(alerts)
            .set({
                isResolved: true,
                resolvedAt: new Date(),
                resolvedBy,
                updatedAt: new Date(),
            })
            .where(eq(alerts.alertId, alertId))
            .returning();

        return resolved;
    }
}