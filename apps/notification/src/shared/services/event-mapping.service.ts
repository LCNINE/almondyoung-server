// apps/notification/src/shared/services/event-mapping.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import {
    notificationEvents,
    NotificationEvent,
    NewNotificationEvent,
} from '../../../database/schemas/notification-schema';

@Injectable()
export class EventMappingService {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    async findAll(): Promise<NotificationEvent[]> {
        return this.db.query.notificationEvents.findMany({
            where: eq(notificationEvents.isActive, true),
        });
    }

    async findByKey(eventKey: string): Promise<NotificationEvent | null> {
        const event = await this.db.query.notificationEvents.findFirst({
            where: eq(notificationEvents.eventKey, eventKey),
        });

        return event || null;
    }

    async create(dto: {
        eventKey: string;
        description: string;
        templateKey: string;
        defaultChannels: string[];
        conditions?: any;
    }): Promise<NotificationEvent> {
        const newEvent: NewNotificationEvent = {
            eventKey: dto.eventKey,
            description: dto.description,
            templateKey: dto.templateKey,
            defaultChannels: dto.defaultChannels,
            conditions: dto.conditions,
            isActive: true,
        };

        const [result] = await this.db
            .insert(notificationEvents)
            .values(newEvent)
            .returning();

        return result;
    }

    async update(eventKey: string, dto: any): Promise<NotificationEvent> {
        const [updated] = await this.db
            .update(notificationEvents)
            .set({
                ...dto,
                updatedAt: new Date(),
            })
            .where(eq(notificationEvents.eventKey, eventKey))
            .returning();

        return updated;
    }
}